import React, { useState, useEffect } from 'react';
import { validateGeminiApiKey, saveStoredApiKey } from '../services/geminiSubtitle';

interface GeminiKeyModalProps {
  isOpen: boolean;
  initialKey: string;
  initialStorageType: 'session' | 'local' | 'none';
  onClose: () => void;
  onConnected: (key: string, storageType: 'session' | 'local') => void;
}

export const GeminiKeyModal: React.FC<GeminiKeyModalProps> = ({
  isOpen,
  initialKey,
  initialStorageType,
  onClose,
  onConnected
}) => {
  const [inputKey, setInputKey] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [rememberOption, setRememberOption] = useState<boolean>(false);
  const [isValidating, setIsValidating] = useState<boolean>(false);
  const [modalError, setModalError] = useState<string>('');

  useEffect(() => {
    if (isOpen) {
      setInputKey(initialKey);
      setRememberOption(initialStorageType === 'local');
      setModalError('');
      setShowPassword(false);
    }
  }, [isOpen, initialKey, initialStorageType]);

  if (!isOpen) return null;

  const handleConnect = async () => {
    const clean = inputKey.trim();
    if (!clean) {
      setModalError('Vui lòng nhập Gemini API Key.');
      return;
    }

    setIsValidating(true);
    setModalError('');

    try {
      const res = await validateGeminiApiKey(clean);
      if (res.success) {
        saveStoredApiKey(clean, rememberOption);
        const sType = rememberOption ? 'local' : 'session';
        onConnected(clean, sType);
        onClose();
      } else {
        setModalError(res.message);
      }
    } catch (err: any) {
      setModalError('Không thể xác thực: ' + (err.message || 'Lỗi mạng'));
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'rgba(15, 23, 42, 0.65)',
      backdropFilter: 'blur(4px)',
      zIndex: 99999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem'
    }}>
      <div style={{
        background: '#ffffff',
        borderRadius: '16px',
        padding: '2rem',
        maxWidth: '520px',
        width: '100%',
        boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
        boxSizing: 'border-box'
      }}>
        <h3 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1a3c5e', margin: '0 0 0.75rem 0' }}>
          KẾT NỐI GEMINI CÁ NHÂN
        </h3>

        <p style={{ fontSize: '0.88rem', color: '#475569', lineHeight: 1.5, margin: '0 0 1.25rem 0' }}>
          Chức năng AI sử dụng Gemini API Key của riêng bạn.
          Hạn mức Gemini thuộc project Google của bạn.
          Khoa không cung cấp hoặc lưu trữ API Key dùng chung.
        </p>

        {/* Nút Lấy Gemini Key miễn phí */}
        <div style={{ marginBottom: '1.25rem' }}>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              color: '#0284c7',
              fontSize: '0.85rem',
              fontWeight: 600,
              textDecoration: 'none'
            }}
          >
            [ Lấy Gemini Key miễn phí ↗ ]
          </a>
          <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.2rem' }}>
            Mở Google AI Studio để tạo API Key miễn phí cho tài khoản của bạn.
          </div>
        </div>

        {/* Ô nhập API Key */}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
            Gemini API Key:
          </label>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="Nhập AIzaSy..."
              autoComplete="off"
              spellCheck="false"
              disabled={isValidating}
              style={{
                width: '100%',
                padding: '0.65rem 2.5rem 0.65rem 0.75rem',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '0.9rem',
                fontFamily: showPassword ? 'monospace' : 'inherit',
                boxSizing: 'border-box'
              }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              title={showPassword ? 'Ẩn khóa' : 'Hiện khóa'}
              style={{
                position: 'absolute',
                right: '0.6rem',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1rem',
                color: '#64748b',
                padding: '0.2rem'
              }}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>
        </div>

        {/* Tùy chọn lưu trữ */}
        <div style={{
          background: '#f8fafc',
          padding: '0.85rem',
          borderRadius: '8px',
          border: '1px solid #e2e8f0',
          marginBottom: '1.25rem'
        }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
            Tùy chọn lưu trữ khóa:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
            <label style={{ fontSize: '0.82rem', color: '#475569', display: 'flex', alignItems: 'flex-start', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="storageOption"
                checked={!rememberOption}
                onChange={() => setRememberOption(false)}
              />
              <span>
                <strong>Chỉ dùng trong phiên này (Khuyên dùng)</strong>
                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Tự động xóa khi đóng tab hoặc khi đăng xuất Portal.
                </div>
              </span>
            </label>
            <label style={{ fontSize: '0.82rem', color: '#475569', display: 'flex', alignItems: 'flex-start', gap: '0.4rem', cursor: 'pointer' }}>
              <input
                type="radio"
                name="storageOption"
                checked={rememberOption}
                onChange={() => setRememberOption(true)}
              />
              <span>
                <strong>Ghi nhớ trên thiết bị này</strong>
                <div style={{ fontSize: '0.75rem', color: '#b45309' }}>
                  ⚠️ Chỉ nên ghi nhớ khóa trên thiết bị cá nhân.
                </div>
              </span>
            </label>
          </div>
        </div>

        {/* Lỗi xác thực nếu có */}
        {modalError && (
          <div style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            padding: '0.65rem 0.85rem',
            borderRadius: '6px',
            fontSize: '0.82rem',
            marginBottom: '1.25rem'
          }}>
            {modalError}
          </div>
        )}

        {/* Nút hành động */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isValidating}
            style={{
              background: '#f1f5f9',
              border: '1px solid #cbd5e1',
              color: '#475569',
              padding: '0.6rem 1.1rem',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: isValidating ? 'not-allowed' : 'pointer'
            }}
          >
            Hủy
          </button>
          <button
            type="button"
            onClick={handleConnect}
            disabled={isValidating}
            style={{
              background: '#1a3c5e',
              border: 'none',
              color: '#ffffff',
              padding: '0.6rem 1.25rem',
              borderRadius: '6px',
              fontSize: '0.85rem',
              fontWeight: 600,
              cursor: isValidating ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem'
            }}
          >
            {isValidating ? 'Đang kiểm tra...' : 'Kiểm tra & Kết nối'}
          </button>
        </div>
      </div>
    </div>
  );
};
