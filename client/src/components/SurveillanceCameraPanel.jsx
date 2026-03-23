import { useState, useRef, useEffect, useCallback } from 'react';
import './SurveillanceCameraPanel.css';

const SURVEILLANCE_SLOT = 'C3';
const SCAN_INTERVAL_MS = 60000; // 60 seconds

function SurveillanceCameraPanel({ onSlotUpdate }) {
    const [cameraActive, setCameraActive] = useState(false);
    const [cameraError, setCameraError] = useState('');
    const [countdown, setCountdown] = useState(SCAN_INTERVAL_MS / 1000);
    const [isScanning, setIsScanning] = useState(false);
    const [scanLogs, setScanLogs] = useState([]);
    const [lastResult, setLastResult] = useState(null);
    const [c3Status, setC3Status] = useState(null);
    const [devices, setDevices] = useState([]);
    const [selectedDevice, setSelectedDevice] = useState('');

    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const countdownRef = useRef(null);

    // Fetch C3 slot status
    const fetchC3Status = useCallback(async () => {
        try {
            const res = await fetch('/api/surveillance/status');
            const data = await res.json();
            if (data.success) setC3Status(data);
        } catch (e) {
            console.error('C3 status error:', e);
        }
    }, []);

    useEffect(() => {
        fetchC3Status();
        navigator.mediaDevices.enumerateDevices().then(devs => {
            const cams = devs.filter(d => d.kind === 'videoinput');
            setDevices(cams);
            if (cams.length > 1) setSelectedDevice(cams[1].deviceId);
            else if (cams.length === 1) setSelectedDevice(cams[0].deviceId);
        }).catch(() => {});
    }, []);

    const addLog = useCallback((entry) => {
        setScanLogs(prev => [entry, ...prev].slice(0, 30));
    }, []);

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(t => t.stop());
            streamRef.current = null;
        }
        setCameraActive(false);
    }, []);

    const startCamera = useCallback(async (deviceId) => {
        try {
            stopCamera();
            const constraints = {
                video: deviceId
                    ? { deviceId: { exact: deviceId }, width: 640, height: 480 }
                    : { facingMode: 'environment', width: 640, height: 480 }
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                streamRef.current = stream;
            }
            setCameraActive(true);
            setCameraError('');
            addLog({ type: 'info', text: `📷 Camera khởi động tại ô ${SURVEILLANCE_SLOT}`, time: new Date() });
        } catch (err) {
            setCameraError('Không thể mở camera: ' + err.message);
            setCameraActive(false);
            addLog({ type: 'error', text: '❌ Lỗi camera: ' + err.message, time: new Date() });
        }
    }, [addLog, stopCamera]);

    const doScan = useCallback(async () => {
        if (isScanning) return;
        setIsScanning(true);
        addLog({ type: 'scan', text: '🔍 Đang quét biển số...', time: new Date() });

        try {
            let imageData = null;
            if (videoRef.current && canvasRef.current) {
                const canvas = canvasRef.current;
                const video = videoRef.current;
                canvas.width = video.videoWidth || 640;
                canvas.height = video.videoHeight || 480;
                canvas.getContext('2d').drawImage(video, 0, 0);
                imageData = canvas.toDataURL('image/jpeg', 0.7);
            }

            const res = await fetch('/api/surveillance/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: imageData, slotId: SURVEILLANCE_SLOT })
            });
            const data = await res.json();
            setLastResult(data);

            if (data.success && data.detected && data.moved) {
                addLog({ type: 'alert', text: `🚗 ${data.licensePlate}: ${data.oldSlot} → ${data.newSlot}`, time: new Date() });
                if (onSlotUpdate) onSlotUpdate();
                fetchC3Status();
            } else if (data.success && data.detected && !data.moved) {
                addLog({ type: 'info', text: `✅ ${data.licensePlate} ở đúng vị trí ${SURVEILLANCE_SLOT}`, time: new Date() });
            } else if (data.success && !data.detected) {
                addLog({ type: 'info', text: '📷 Không phát hiện xe mới', time: new Date() });
            } else {
                addLog({ type: 'warn', text: '⚠️ ' + (data.message || data.error), time: new Date() });
            }
        } catch (err) {
            addLog({ type: 'error', text: '❌ Lỗi quét: ' + err.message, time: new Date() });
        } finally {
            setIsScanning(false);
        }
    }, [isScanning, addLog, onSlotUpdate, fetchC3Status]);

    // Countdown + auto trigger scan
    useEffect(() => {
        if (!cameraActive) {
            clearInterval(countdownRef.current);
            setCountdown(SCAN_INTERVAL_MS / 1000);
            return;
        }
        setCountdown(SCAN_INTERVAL_MS / 1000);
        countdownRef.current = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    doScan();
                    return SCAN_INTERVAL_MS / 1000;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(countdownRef.current);
    }, [cameraActive, doScan]);

    const handleToggleCamera = () => {
        if (cameraActive) stopCamera();
        else startCamera(selectedDevice);
    };

    const progressPercent = ((SCAN_INTERVAL_MS / 1000 - countdown) / (SCAN_INTERVAL_MS / 1000)) * 100;

    return (
        <div className="surveillance-panel">
            {/* ── Header ── */}
            <div className="surv-header">
                <div className="surv-title-row">
                    <span className="surv-icon">📷</span>
                    <div>
                        <h2 className="surv-title">Camera Quan Sát</h2>
                        <p className="surv-subtitle">Giám sát ô <strong>{SURVEILLANCE_SLOT}</strong> – Tự động cập nhật mỗi 60 giây</p>
                    </div>
                    <div className={`surv-badge ${cameraActive ? 'live' : 'offline'}`}>
                        {cameraActive ? '🔴 LIVE' : '⚫ OFFLINE'}
                    </div>
                </div>
            </div>

            <div className="surv-body">
                {/* ── Top row: C3 status + last result ── */}
                <div className="surv-top-row">
                    <div className="c3-status-card">
                        <div className="c3-label">📍 Trạng thái ô {SURVEILLANCE_SLOT}</div>
                        {c3Status ? (
                            <div className={`c3-status ${c3Status.slotStatus}`}>
                                {c3Status.slotStatus === 'occupied'
                                    ? <><span className="c3-car-icon">🚗</span><span className="c3-plate">{c3Status.licensePlate}</span></>
                                    : <span className="c3-empty">Trống</span>}
                            </div>
                        ) : <span className="c3-loading">Đang tải...</span>}
                    </div>

                    {lastResult && lastResult.detected && (
                        <div className={`last-result ${lastResult.moved ? 'moved' : 'no-move'}`}>
                            <div className="result-title">Lần quét gần nhất:</div>
                            <div className="result-plate">🚗 {lastResult.licensePlate}</div>
                            {lastResult.moved && (
                                <div className="result-move">{lastResult.oldSlot} → <strong>{lastResult.newSlot}</strong></div>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Main area: camera (left) + log (right) ── */}
                <div className="surv-main-area">
                    {/* Camera column */}
                    <div className="surv-left">
                        {/* Device selector */}
                        {devices.length > 1 && (
                            <div className="device-selector">
                                <label>🎥 Chọn camera:</label>
                                <select
                                    value={selectedDevice}
                                    onChange={e => {
                                        setSelectedDevice(e.target.value);
                                        if (cameraActive) startCamera(e.target.value);
                                    }}
                                >
                                    {devices.map((d, i) => (
                                        <option key={d.deviceId} value={d.deviceId}>
                                            {d.label || `Camera ${i + 1}`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Video feed */}
                        <div className="video-wrapper">
                            <video ref={videoRef} autoPlay playsInline muted
                                className={`surv-video ${cameraActive ? 'active' : 'inactive'}`} />
                            <canvas ref={canvasRef} style={{ display: 'none' }} />
                            {!cameraActive && (
                                <div className="video-placeholder">
                                    <span>📷</span>
                                    <p>Camera chưa bật</p>
                                </div>
                            )}
                            {isScanning && (
                                <div className="scan-overlay">
                                    <div className="scan-line" />
                                    <span>Đang quét...</span>
                                </div>
                            )}
                            <div className="slot-badge">Ô {SURVEILLANCE_SLOT}</div>
                        </div>

                        {cameraError && <div className="surv-error">{cameraError}</div>}

                        {/* Countdown bar */}
                        {cameraActive && (
                            <div className="countdown-section">
                                <div className="countdown-row">
                                    <span>⏱ Quét tiếp theo:</span>
                                    <span className="countdown-num">{countdown}s</span>
                                </div>
                                <div className="countdown-bar">
                                    <div className="countdown-fill" style={{ width: `${progressPercent}%` }} />
                                </div>
                            </div>
                        )}

                        {/* Buttons */}
                        <div className="surv-controls">
                            <button
                                className={`btn-surv ${cameraActive ? 'btn-stop' : 'btn-start'}`}
                                onClick={handleToggleCamera}
                            >
                                {cameraActive ? '⏹ Tắt Camera' : '▶ Bật Camera'}
                            </button>
                            <button
                                className="btn-surv btn-scan"
                                onClick={doScan}
                                disabled={!cameraActive || isScanning}
                            >
                                {isScanning ? '🔄 Đang quét...' : '🔍 Quét ngay'}
                            </button>
                        </div>
                    </div>

                    {/* Log column */}
                    <div className="surv-right">
                        <div className="log-header">
                            <h3>📋 Nhật ký sự kiện</h3>
                            <button className="btn-clear" onClick={() => setScanLogs([])}>Xóa</button>
                        </div>
                        <div className="log-list">
                            {scanLogs.length === 0 && (
                                <div className="log-empty">Chưa có sự kiện nào.<br />Bật camera để bắt đầu giám sát.</div>
                            )}
                            {scanLogs.map((log, i) => (
                                <div key={i} className={`log-item log-${log.type}`}>
                                    <span className="log-time">{log.time.toLocaleTimeString('vi-VN')}</span>
                                    <span className="log-text">{log.text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default SurveillanceCameraPanel;
