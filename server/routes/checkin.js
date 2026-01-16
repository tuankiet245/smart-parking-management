import express from 'express';
import ParkingSlot from '../models/ParkingSlot.js';
import History from '../models/History.js';

const router = express.Router();

// Helper function to validate license plate format
function validateLicensePlate(plate) {
    if (!plate || typeof plate !== 'string') return false;

    // Vietnamese license plate formats:
    // - 59-P1 123.45 (with dashes and dots)
    // - 51-B3 789.01 (letter + number combination)
    // - 30A2456.78 (compact format)
    // - 29-C4 234.56 (standard format)

    const cleaned = plate.trim().toUpperCase().replace(/\s/g, '');

    // Very flexible pattern for Vietnamese plates
    // Format: 2 digits, optional dash, 1-2 letters, 1 digit, optional space/dot, 3-5 digits
    const patterns = [
        /^\d{2}-?[A-Z]{1,2}\d[\s.-]?\d{3}[\s.-]?\d{2}$/,  // 59-P1 123.45, 51-B3 789.01
        /^\d{2}[A-Z]{1,2}\d{5}$/,                          // 59P112345
        /^\d{2}-[A-Z]{1,2}\d{5}$/                          // 59-AB12345
    ];

    return patterns.some(pattern => pattern.test(cleaned));
}

// Find nearest empty slot
function findNearestSlot(slots, entryPosition = { row: 0, col: 0 }) {
    let nearest = null;
    let minDistance = Infinity;

    for (const slot of slots) {
        const distance = Math.sqrt(
            Math.pow(slot.position.row - entryPosition.row, 2) +
            Math.pow(slot.position.col - entryPosition.col, 2)
        );

        if (distance < minDistance) {
            minDistance = distance;
            nearest = slot;
        }
    }

    return nearest;
}

// POST /api/checkin - Check-in vehicle
router.post('/', async (req, res) => {
    try {
        const { licensePlate, evidenceImage } = req.body;

        if (!licensePlate) {
            return res.status(400).json({
                success: false,
                error: 'Biển số xe là bắt buộc'
            });
        }

        // Validate license plate format
        if (!validateLicensePlate(licensePlate)) {
            return res.status(400).json({
                success: false,
                error: 'Biển số xe không hợp lệ'
            });
        }

        const normalizedPlate = licensePlate.trim().toUpperCase();

        // Check if vehicle already checked in
        const existing = await ParkingSlot.findOne({
            licensePlate: normalizedPlate,
            status: 'occupied'
        });

        if (existing) {
            return res.status(400).json({
                success: false,
                error: `Xe đã có trong bãi tại vị trí ${existing.slotId}`,
                slotId: existing.slotId
            });
        }

        // Check for unpaid history records
        const unpaidHistory = await History.findOne({
            licensePlate: normalizedPlate,
            paymentStatus: 'unpaid',
            checkOutTime: { $ne: null }
        });

        if (unpaidHistory) {
            return res.status(400).json({
                success: false,
                error: 'Xe có khoản chưa thanh toán. Vui lòng thanh toán trước khi vào bãi',
                fee: unpaidHistory.fee
            });
        }

        // Find empty slot
        const emptySlots = await ParkingSlot.find({ status: 'empty' });

        if (emptySlots.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Bãi xe đã đầy'
            });
        }

        // Get nearest slot to entrance
        const slot = findNearestSlot(emptySlots);

        // Update slot
        slot.status = 'occupied';
        slot.licensePlate = normalizedPlate;
        slot.checkInTime = new Date();
        await slot.save();

        // Create history record
        const history = new History({
            licensePlate: normalizedPlate,
            checkInTime: slot.checkInTime,
            slotUsed: slot.slotId,
            evidenceImage
        });
        await history.save();

        // Emit socket event for real-time update
        const io = req.app.get('io');
        if (io) {
            io.emit('slot-update', {
                slotId: slot.slotId,
                status: 'occupied',
                licensePlate: normalizedPlate
            });
        }

        res.json({
            success: true,
            slotId: slot.slotId,
            licensePlate: normalizedPlate,
            checkInTime: slot.checkInTime,
            message: `Mời xe ${normalizedPlate} vào bãi, vị trí ${slot.slotId}`
        });

    } catch (error) {
        console.error('Check-in error:', error);
        res.status(500).json({
            success: false,
            error: 'Lỗi server'
        });
    }
});

export default router;
