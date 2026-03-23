import express from 'express';
import ParkingSlot from '../models/ParkingSlot.js';

const router = express.Router();

// Simulated license plate detection from image
// In production, integrate real OCR (Tesseract / ONNX)
function detectPlateFromImage(imageBase64) {
    // If there is no real image or too short, return null
    if (!imageBase64 || imageBase64.length < 100) return null;

    // Demo: try to find any occupied car from DB instead of real OCR
    // Real OCR would go here
    return null; // Will be handled in route logic
}

// POST /api/surveillance/scan
// Body: { image: "data:image/jpeg;base64,..." , slotId: "C3" }
router.post('/scan', async (req, res) => {
    try {
        const { image, slotId = 'C3', forcePlate } = req.body;

        if (!image && !forcePlate) {
            return res.status(400).json({ success: false, error: 'Không có dữ liệu ảnh' });
        }

        const io = req.app.get('io');

        // --- License plate detection ---
        // In demo mode: if forcePlate is provided, use it directly
        // Otherwise try to get the first occupied car not at C3 (simulate camera seeing it)
        let licensePlate = forcePlate || null;

        if (!licensePlate) {
            // Simulate: camera sees the first occupied slot not at targetSlot
            const occupied = await ParkingSlot.findOne({
                status: 'occupied',
                slotId: { $ne: slotId }
            });
            if (occupied) {
                licensePlate = occupied.licensePlate;
            }
        }

        if (!licensePlate) {
            return res.json({
                success: true,
                detected: false,
                message: 'Không phát hiện biển số xe nào trong ảnh',
                timestamp: new Date()
            });
        }

        // Find current slot of this car
        const currentSlot = await ParkingSlot.findOne({
            licensePlate,
            status: 'occupied'
        });

        if (!currentSlot) {
            return res.json({
                success: true,
                detected: true,
                licensePlate,
                message: `Phát hiện biển số ${licensePlate} nhưng xe không có trong hệ thống`,
                timestamp: new Date()
            });
        }

        // If car is already at target slot, no update needed
        if (currentSlot.slotId === slotId) {
            return res.json({
                success: true,
                detected: true,
                licensePlate,
                oldSlot: slotId,
                newSlot: slotId,
                moved: false,
                message: `Xe ${licensePlate} đang ở đúng vị trí ${slotId}`,
                timestamp: new Date()
            });
        }

        const oldSlotId = currentSlot.slotId;

        // Free old slot
        currentSlot.status = 'empty';
        currentSlot.licensePlate = null;
        currentSlot.checkInTime = null;
        await currentSlot.save();

        // Occupy target slot (C3)
        const targetSlot = await ParkingSlot.findOne({ slotId });
        if (!targetSlot) {
            return res.status(404).json({
                success: false,
                error: `Ô ${slotId} không tồn tại trong hệ thống`
            });
        }

        // If target slot is already occupied by someone else, free that too
        if (targetSlot.status === 'occupied' && targetSlot.licensePlate !== licensePlate) {
            // Don't overwrite - just report
            return res.json({
                success: false,
                detected: true,
                licensePlate,
                message: `Ô ${slotId} đang bị chiếm bởi xe khác (${targetSlot.licensePlate})`,
                timestamp: new Date()
            });
        }

        targetSlot.status = 'occupied';
        targetSlot.licensePlate = licensePlate;
        targetSlot.checkInTime = targetSlot.checkInTime || currentSlot.checkInTime || new Date();
        await targetSlot.save();

        // Emit realtime updates
        if (io) {
            io.emit('slot-update', { slotId: oldSlotId, status: 'empty', licensePlate: null });
            io.emit('slot-update', { slotId, status: 'occupied', licensePlate });
            io.emit('surveillance-alert', {
                licensePlate,
                oldSlot: oldSlotId,
                newSlot: slotId,
                timestamp: new Date(),
                message: `📷 Camera C3 phát hiện: xe ${licensePlate} đã di chuyển từ ${oldSlotId} → ${slotId}`
            });
        }

        res.json({
            success: true,
            detected: true,
            moved: true,
            licensePlate,
            oldSlot: oldSlotId,
            newSlot: slotId,
            message: `✅ Xe ${licensePlate} đã được cập nhật từ ${oldSlotId} → ${slotId}`,
            timestamp: new Date()
        });

    } catch (error) {
        console.error('Surveillance scan error:', error);
        res.status(500).json({ success: false, error: 'Lỗi server khi quét camera' });
    }
});

// GET /api/surveillance/status - Camera status
router.get('/status', async (req, res) => {
    try {
        const c3Slot = await ParkingSlot.findOne({ slotId: 'C3' });
        res.json({
            success: true,
            cameraSlot: 'C3',
            slotStatus: c3Slot ? c3Slot.status : 'unknown',
            licensePlate: c3Slot?.licensePlate || null,
            lastChecked: new Date()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Lỗi server' });
    }
});

export default router;
