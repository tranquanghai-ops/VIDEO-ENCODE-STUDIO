import React from 'react';
import { getModelInfo } from '../services/modelRegistry';

interface HeaderGeminiStatusProps {
  isConnected: boolean;
  keyStorageType: 'session' | 'local' | 'none';
  activeKeyName: string;
  keyCount: number;
  selectedModel: string;
  userEmail?: string;
  onOpenModal: () => void;
  onDisconnect: () => void;
}

export const HeaderGeminiStatus: React.FC<HeaderGeminiStatusProps> = ({
  isConnected,
  keyStorageType,
  activeKeyName,
  keyCount,
  selectedModel,
  userEmail,
  onOpenModal,
  onDisconnect
}) => {
  const modelInfo = getModelInfo(selectedModel);
  const modelLabel = selectedModel === 'auto' ? 'Tự động' : modelInfo?.displayName || selectedModel;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.65rem',
      background: 'rgba(255, 255, 255, 0.08)',
      padding: '0.4rem 0.85rem',
      borderRadius: '10px',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      color: '#ffffff',
      fontSize: '0.8rem',
      flexWrap: 'wrap'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <strong style={{ letterSpacing: '0.03em', color: '#e2e8f0' }}>Gemini AI:</strong>
        {isConnected ? (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            background: 'rgba(16, 185, 129, 0.2)',
            color: '#34d399',
            padding: '0.2rem 0.55rem',
            borderRadius: '12px',
            fontWeight: 600,
            fontSize: '0.76rem'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#10b981' }} />
            {activeKeyName || 'Đã kết nối'} · {modelLabel}{keyCount > 1 ? ` · ${keyCount} keys` : ''}
          </span>
        ) : (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            background: 'rgba(148, 163, 184, 0.2)',
            color: '#cbd5e1',
            padding: '0.2rem 0.55rem',
            borderRadius: '12px',
            fontWeight: 600,
            fontSize: '0.76rem'
          }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#94a3b8' }} />
            Chưa kết nối
          </span>
        )}
      </div>

      {isConnected ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <button
            type="button"
            onClick={onOpenModal}
            title="Quản lý Gemini API Key"
            style={{
              background: 'rgba(255, 255, 255, 0.15)',
              border: 'none',
              color: '#ffffff',
              padding: '0.25rem 0.6rem',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.15s'
            }}
          >
            Quản lý keys
          </button>
          <button
            type="button"
            onClick={onDisconnect}
            title="Xóa toàn bộ Gemini API Key đã lưu"
            style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: 'none',
              color: '#fca5a5',
              padding: '0.25rem 0.6rem',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 0.15s'
            }}
          >
            Xóa tất cả
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenModal}
          style={{
            background: '#38bdf8',
            border: 'none',
            color: '#0f172a',
            padding: '0.25rem 0.75rem',
            borderRadius: '6px',
            fontSize: '0.75rem',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
          }}
        >
          Kết nối Gemini cá nhân
        </button>
      )}

      {userEmail && (
        <span style={{
          opacity: 0.65,
          fontSize: '0.72rem',
          borderLeft: '1px solid rgba(255, 255, 255, 0.2)',
          paddingLeft: '0.5rem'
        }} title="Tài khoản đăng nhập Portal">
          👤 {userEmail}
        </span>
      )}
    </div>
  );
};
