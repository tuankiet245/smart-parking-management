import { useState } from 'react';
import { speakText } from '../services/voiceAssistant';
import './CheckoutPanel.css';

function CheckoutPanel({ onComplete }) {
    const [licensePlate, setLicensePlate] = useState('');
    const [checkoutData, setCheckoutData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');


    const handleManualCheckout = async (e) => {
        e.preventDefault();
        await processCheckout(licensePlate);
    };

    const processCheckout = async (plate) => {
        setLoading(true);
        setError('');
        setCheckoutData(null);

        try {
            const response = await fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ licensePlate: plate })
            });

            const data = await response.json();

            if (data.success) {
                setCheckoutData(data);
                speakText(data.message);
            } else {
                setError(data.error);
                speakText(data.error);
            }
        } catch (err) {
            setError('Lỗi kết nối server');
        } finally {
            setLoading(false);
        }
    };

    const handleConfirmPayment = async () => {
        try {
            const response = await fetch('/api/checkout/confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ licensePlate: checkoutData.licensePlate })
            });

            const data = await response.json();

            if (data.success) {
                speakText(data.message);
                setCheckoutData(null);
                setLicensePlate('');
                onComplete();
                alert('Thanh toán thành công! Barrier đã mở.');
            }
        } catch (err) {
            alert('Lỗi xác nhận thanh toán');
        }
    };

    return (
        <div className="checkout-panel">
            <div className="checkout-form card">
                <h2>Check-out & Thanh toán</h2>

                <form onSubmit={handleManualCheckout}>
                    <div className="form-group">
                        <label>Biển số xe:</label>
                        <input
                            type="text"
                            value={licensePlate}
                            onChange={(e) => setLicensePlate(e.target.value.toUpperCase())}
                            placeholder="VD: 59-P1 123.45"
                            required
                            disabled={loading}
                            className="plate-input"
                        />
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <button type="submit" className="btn btn-primary" disabled={loading}>
                        {loading ? 'Đang xử lý...' : 'Tính phí'}
                    </button>
                </form>
            </div>

            {checkoutData && (
                <div className="payment-details card fade-in">
                    <h3>📋 Thông tin thanh toán</h3>

                    <div className="info-grid">
                        <div className="info-item">
                            <span className="label">Biển số:</span>
                            <span className="value">{checkoutData.licensePlate}</span>
                        </div>
                        <div className="info-item">
                            <span className="label">Giờ vào:</span>
                            <span className="value">
                                {new Date(checkoutData.checkInTime).toLocaleString('vi-VN')}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="label">Giờ ra:</span>
                            <span className="value">
                                {new Date(checkoutData.checkOutTime).toLocaleString('vi-VN')}
                            </span>
                        </div>
                        <div className="info-item">
                            <span className="label">Thời gian gửi:</span>
                            <span className="value">{Math.floor(checkoutData.duration / 60)}h {checkoutData.duration % 60}m</span>
                        </div>
                        <div className="info-item fee">
                            <span className="label">Phí gửi xe:</span>
                            <span className="value">{checkoutData.fee.toLocaleString('vi-VN')} đ</span>
                        </div>
                    </div>

                    <div className="qr-section">
                        <h4>📱 Quét mã để thanh toán</h4>
                        <img src={checkoutData.qrCode} alt="VietQR Code" className="qr-code" />
                        <p className="qr-instruction">
                            Mở app ngân hàng → Quét mã QR → Xác nhận thanh toán
                        </p>
                    </div>

                    <button className="btn btn-success" onClick={handleConfirmPayment}>
                        Xác nhận đã thanh toán
                    </button>
                </div>
            )}
        </div>
    );
}

export default CheckoutPanel;
