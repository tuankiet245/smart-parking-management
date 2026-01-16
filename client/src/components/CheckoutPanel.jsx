import { useState, useRef, useEffect } from 'react';
import { detectLicensePlate } from '../services/detection';
import { speakText } from '../services/voiceAssistant';
import './CheckoutPanel.css';

function CheckoutPanel({ onComplete }) {
    const [licensePlate, setLicensePlate] = useState('');
    const [checkoutData, setCheckoutData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [mode, setMode] = useState('manual'); // 'auto' or 'manual'
    const [isDetecting, setIsDetecting] = useState(false);
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);

    useEffect(() => {
        if (mode === 'auto') {
            startCamera();
        }
        return () => stopCamera();
    }, [mode]);

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480 }
            });
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                streamRef.current = stream;
            }
        } catch (error) {
            console.error('Camera error:', error);
            alert('Lỗi camera - Chuyển sang chế độ thủ công');
            setMode('manual');
        }
    };

    const stopCamera = () => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
        }
    };

    const handleAutoDetect = async () => {
        if (!videoRef.current || isDetecting) return;

        setIsDetecting(true);
        setError('');

        try {
            const canvas = canvasRef.current;
            const video = videoRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);

            const imageData = canvas.toDataURL('image/jpeg');
            const result = await detectLicensePlate(imageData);

            if (result.plate) {
                setLicensePlate(result.plate);
                await processCheckout(result.plate);
            } else {
                setError('Không phát hiện biển số. Vui lòng thử lại');
                speakText('Không phát hiện biển số');
            }
        } catch (error) {
            console.error('Detection error:', error);
            setError('Lỗi nhận diện');
        } finally {
            setIsDetecting(false);
        }
    };

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

                <div className="mode-toggle">
                    <button
                        className={`mode-btn ${mode === 'manual' ? 'active' : ''}`}
                        onClick={() => setMode('manual')}
                    >
                        Thủ công
                    </button>
                    <button
                        className={`mode-btn ${mode === 'auto' ? 'active' : ''}`}
                        onClick={() => setMode('auto')}
                    >
                        Tự động (AI)
                    </button>
                </div>

                {mode === 'manual' ? (
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
                ) : (
                    <div className="auto-mode">
                        <div className="video-container">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className="video-feed"
                            />
                            <canvas ref={canvasRef} style={{ display: 'none' }} />
                        </div>

                        {error && <div className="error-message">{error}</div>}

                        <button
                            className="btn btn-primary"
                            onClick={handleAutoDetect}
                            disabled={isDetecting || loading}
                        >
                            {isDetecting ? 'Đang nhận diện...' : 'Nhận diện biển số'}
                        </button>

                        <div className="instructions">
                            <p><strong>Hướng dẫn:</strong></p>
                            <ul>
                                <li>Đưa biển số xe vào trước camera</li>
                                <li>Nhấn "Nhận diện biển số" để quét</li>
                                <li>Chế độ AI dùng dữ liệu demo</li>
                            </ul>
                        </div>
                    </div>
                )}
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
