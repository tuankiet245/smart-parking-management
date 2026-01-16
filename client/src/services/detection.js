import * as ort from 'onnxruntime-web';
import Tesseract from 'tesseract.js';

// Configuration
const MODEL_INPUT_SIZE = 640;
const CONFIDENCE_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;
const DEMO_PLATES = ['59-P1 123.45', '30-A2 456.78', '51-B3 789.01', '29-C4 234.56'];

let yoloSession = null;
let tesseractWorker = null;
let aiReady = false;
let useDemoFallback = false;

/**
 * Initialize AI models
 */
export async function initializeAI() {
    if (aiReady) return true;

    try {
        console.log('🤖 Initializing AI detection system...');

        // Setup ONNX Runtime
        ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.16.3/dist/';

        // Load YOLO model
        try {
            yoloSession = await ort.InferenceSession.create('/models/yolov8n.onnx', {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all'
            });
            console.log('✅ YOLO model loaded successfully');
        } catch (error) {
            console.warn('⚠️ YOLO model not found, using demo mode');
            console.error('Model error:', error);
            useDemoFallback = true;
            return true; // Still return true to allow demo mode
        }

        // Initialize Tesseract OCR
        try {
            tesseractWorker = await Tesseract.createWorker('eng');
            await tesseractWorker.setParameters({
                tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. ',
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
            });
            console.log('✅ Tesseract OCR initialized');
        } catch (error) {
            console.warn('⚠️ OCR initialization warning:', error);
        }

        aiReady = true;
        return true;
    } catch (error) {
        console.error('❌ AI initialization failed:', error);
        useDemoFallback = true;
        return true; // Allow demo mode
    }
}

/**
 * Preprocess image for YOLO
 */
async function preprocessImage(imageDataUrl) {
    const img = new Image();

    return new Promise((resolve) => {
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            canvas.width = MODEL_INPUT_SIZE;
            canvas.height = MODEL_INPUT_SIZE;

            // Calculate scaling
            const scale = Math.min(MODEL_INPUT_SIZE / img.width, MODEL_INPUT_SIZE / img.height);
            const scaledWidth = img.width * scale;
            const scaledHeight = img.height * scale;
            const x = (MODEL_INPUT_SIZE - scaledWidth) / 2;
            const y = (MODEL_INPUT_SIZE - scaledHeight) / 2;

            // Draw with black background
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

            // Apply preprocessing
            ctx.filter = 'contrast(1.3) brightness(1.1)';
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, x, y, scaledWidth, scaledHeight);

            // Convert to tensor
            const imageData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
            const pixels = imageData.data;

            const red = [], green = [], blue = [];
            for (let i = 0; i < pixels.length; i += 4) {
                red.push(pixels[i] / 255.0);
                green.push(pixels[i + 1] / 255.0);
                blue.push(pixels[i + 2] / 255.0);
            }

            const inputTensor = new Float32Array(3 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE);
            red.forEach((val, idx) => inputTensor[idx] = val);
            green.forEach((val, idx) => inputTensor[MODEL_INPUT_SIZE * MODEL_INPUT_SIZE + idx] = val);
            blue.forEach((val, idx) => inputTensor[2 * MODEL_INPUT_SIZE * MODEL_INPUT_SIZE + idx] = val);

            const tensor = new ort.Tensor('float32', inputTensor, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);

            resolve({ tensor, originalImage: img, scale, offsetX: x, offsetY: y });
        };

        img.onerror = () => {
            console.error('Image loading failed');
            resolve(null);
        };

        img.src = imageDataUrl;
    });
}

/**
 * Run YOLO inference
 */
async function runYOLOInference(tensor) {
    try {
        const results = await yoloSession.run({ images: tensor });
        return results.output0;
    } catch (error) {
        console.error('YOLO inference error:', error);
        return null;
    }
}

/**
 * Parse YOLO output to bounding boxes
 */
function parseYOLOOutput(output) {
    const boxes = [];
    const data = output.data;
    const dims = output.dims;

    const rows = dims[2];
    const cols = dims[1];

    for (let i = 0; i < rows; i++) {
        const x = data[i];
        const y = data[rows + i];
        const w = data[2 * rows + i];
        const h = data[3 * rows + i];

        let maxScore = 0;
        for (let j = 4; j < cols; j++) {
            const score = data[j * rows + i];
            if (score > maxScore) maxScore = score;
        }

        // Filter for license plate shapes (horizontal rectangles)
        const aspectRatio = w / h;
        const isPlateShape = aspectRatio > 2.0 && aspectRatio < 5.5;

        if (maxScore > CONFIDENCE_THRESHOLD && isPlateShape) {
            boxes.push({
                x: x - w / 2,
                y: y - h / 2,
                width: w,
                height: h,
                confidence: maxScore,
                aspectRatio
            });
        }
    }

    return boxes;
}

/**
 * Non-maximum suppression
 */
function nonMaxSuppression(boxes) {
    boxes.sort((a, b) => b.confidence - a.confidence);
    const selected = [];
    const suppressed = new Set();

    for (let i = 0; i < boxes.length; i++) {
        if (suppressed.has(i)) continue;
        selected.push(boxes[i]);

        for (let j = i + 1; j < boxes.length; j++) {
            if (suppressed.has(j)) continue;
            const iou = calculateIoU(boxes[i], boxes[j]);
            if (iou > IOU_THRESHOLD) suppressed.add(j);
        }
    }

    return selected;
}

/**
 * Calculate Intersection over Union
 */
function calculateIoU(box1, box2) {
    const x1 = Math.max(box1.x, box2.x);
    const y1 = Math.max(box1.y, box2.y);
    const x2 = Math.min(box1.x + box1.width, box2.x + box2.width);
    const y2 = Math.min(box1.y + box1.height, box2.y + box2.height);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const area1 = box1.width * box1.height;
    const area2 = box2.width * box2.height;
    const union = area1 + area2 - intersection;

    return intersection / union;
}

/**
 * OCR on detected region
 */
async function performOCR(originalImage, box) {
    if (!tesseractWorker) {
        console.warn('OCR not available');
        return { text: '', confidence: 0 };
    }

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    // Add padding around detected region
    const padding = 10;
    const x = Math.max(0, box.x - padding);
    const y = Math.max(0, box.y - padding);
    const w = Math.min(originalImage.width - x, box.width + 2 * padding);
    const h = Math.min(originalImage.height - y, box.height + 2 * padding);

    // High resolution for better OCR
    const targetWidth = Math.max(400, w * 2);
    const targetHeight = (h / w) * targetWidth;

    canvas.width = targetWidth;
    canvas.height = targetHeight;

    // Enhance for OCR
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);
    ctx.filter = 'contrast(2.0) saturate(0) brightness(1.3)';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(originalImage, x, y, w, h, 0, 0, targetWidth, targetHeight);

    const imageData = canvas.toDataURL('image/png');

    try {
        const { data: { text, confidence } } = await tesseractWorker.recognize(imageData);
        const cleaned = cleanOCRText(text);

        console.log(`📝 OCR Result: "${cleaned}" (${confidence.toFixed(1)}%)`);
        return { text: cleaned, confidence: confidence / 100 };
    } catch (error) {
        console.error('OCR error:', error);
        return { text: '', confidence: 0 };
    }
}

/**
 * Clean OCR text
 */
function cleanOCRText(text) {
    return text
        .replace(/\n/g, '')
        .replace(/\s+/g, '')
        .replace(/[^0-9A-Z\-.]/gi, '')
        .replace(/O/gi, '0')
        .replace(/I/gi, '1')
        .replace(/Z/gi, '2')
        .replace(/S/gi, '5')
        .replace(/B/gi, '8')
        .toUpperCase()
        .trim();
}

/**
 * Main detection function
 */
export async function detectLicensePlate(imageData) {
    // Initialize if not ready
    if (!aiReady) {
        await initializeAI();
    }

    // Fallback to demo mode if needed
    if (useDemoFallback || !yoloSession) {
        console.log('🎲 Using demo mode');
        return useDemoMode();
    }

    try {
        console.log('🔍 Starting license plate detection...');

        // Preprocess image
        const preprocessed = await preprocessImage(imageData);
        if (!preprocessed) {
            console.error('Preprocessing failed');
            return useDemoMode();
        }

        console.log('✅ Image preprocessed');

        // Run YOLO detection
        const output = await runYOLOInference(preprocessed.tensor);
        if (!output) {
            console.error('YOLO inference failed');
            return useDemoMode();
        }

        // Parse detections
        const boxes = parseYOLOOutput(output);
        console.log(`✅ Detected ${boxes.length} potential plates`);

        if (boxes.length === 0) {
            console.warn('No plates detected');
            return { plate: null, confidence: 0 };
        }

        // Apply NMS
        const filtered = nonMaxSuppression(boxes);
        console.log(`✅ After NMS: ${filtered.length} candidates`);

        // Try OCR on best candidates
        const topCandidates = filtered.slice(0, 3);
        let bestResult = { text: '', confidence: 0 };

        for (const box of topCandidates) {
            const ocrResult = await performOCR(preprocessed.originalImage, box);

            if (ocrResult.text.length >= 7 && ocrResult.confidence > bestResult.confidence) {
                bestResult = {
                    text: ocrResult.text,
                    confidence: ocrResult.confidence,
                    bbox: box
                };
            }
        }

        if (bestResult.text.length >= 7) {
            const formatted = formatPlate(bestResult.text);
            console.log(`✅ Final result: ${formatted}`);
            return {
                plate: formatted,
                confidence: Math.min(bestResult.confidence, 0.95),
                bbox: bestResult.bbox,
                demo: false
            };
        }

        console.warn('No valid plates extracted from OCR');
        return { plate: null, confidence: 0 };

    } catch (error) {
        console.error('❌ Detection error:', error);
        return useDemoMode();
    }
}

/**
 * Demo mode fallback
 */
function useDemoMode() {
    const plate = DEMO_PLATES[Math.floor(Math.random() * DEMO_PLATES.length)];
    console.log(`🎲 Demo mode: ${plate}`);
    return { plate, confidence: 0.85, demo: true };
}

/**
 * Validate Vietnamese license plate
 */
export function validateVietnamesePlate(plate) {
    if (!plate || plate.length < 7) return false;

    const patterns = [
        /^\d{2}-[A-Z]\d\s\d{3}\.\d{2}$/,  // 59-P1 123.45
        /^\d{2}[A-Z]\d{5}$/,               // 59P112345
    ];

    return patterns.some(pattern => pattern.test(plate));
}

/**
 * Format plate to standard Vietnamese format
 */
function formatPlate(text) {
    const cleaned = text.replace(/[^0-9A-Z]/g, '');

    // Try to match Vietnamese pattern: XXYZNNNNN
    const match = cleaned.match(/^(\d{2})([A-Z])(\d)(\d{3})(\d{2})$/);

    if (match) {
        return `${match[1]}-${match[2]}${match[3]} ${match[4]}.${match[5]}`;
    }

    return cleaned;
}

/**
 * Cleanup resources
 */
export async function cleanupAI() {
    if (tesseractWorker) {
        await tesseractWorker.terminate();
        tesseractWorker = null;
    }
    if (yoloSession) {
        yoloSession = null;
    }
    aiReady = false;
    console.log('✅ AI cleanup complete');
}

// Auto-initialize
if (typeof window !== 'undefined') {
    setTimeout(() => initializeAI(), 1000);
}
