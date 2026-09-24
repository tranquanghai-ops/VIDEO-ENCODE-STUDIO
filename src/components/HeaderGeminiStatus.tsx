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
}

export const HeaderGeminiStatus: React.FC<HeaderGeminiStatusProps> = ({
  isConnected,
  keyStorageType,
  activeKeyName,
  keyCount,
  selectedModel,
  userEmail,
  onOpenModal
}) => {
  const modelInfo = getModelInfo(selectedModel);
  const modelLabel = selectedModel === 'auto' ? 'Tự động' : modelInfo?.displayName || selectedModel;

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.65rem',
      background: '#f8fafc',
      padding: '0.4rem 0.85rem',
      borderRadius: '10px',
      border: '1px solid #dbe5ec',
      color: '#334155',
      fontSize: '0.8rem',
      flexWrap: 'wrap'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
        <strong style={{ letterSpacing: '0.03em', color: '#334155' }}>Gemini AI:</strong>
        {isConnected ? (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            background: '#def5eb',
            color: '#137d70',
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
            background: '#e8edf2',
            color: '#475569',
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
              background: '#1767d2',
              border: '1px solid #0f4ea7',
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
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenModal}
          style={{
            background: '#1767d2',
            border: 'none',
            color: '#ffffff',
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
          borderLeft: '1px solid #cbd5e1',
          paddingLeft: '0.5rem'
        }} title="Tài khoản đăng nhập Portal">
          👤 {userEmail}
        </span>
      )}
    </div>
  );
};
