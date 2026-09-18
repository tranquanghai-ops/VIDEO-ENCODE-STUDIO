import React, { useEffect, useState } from 'react';
import {
  getStoredApiKey,
  getStoredApiKeys,
  removeStoredApiKey,
  saveStoredApiKey,
  setActiveStoredApiKey,
  validateGeminiApiKey,
  type GeminiKeyProfile
} from '../services/geminiSubtitle';

interface GeminiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected: (profile: GeminiKeyProfile, count: number) => void;
}

const maskKey = (key: string) => key.length < 10 ? '••••••••' : `${key.slice(0, 6)}••••${key.slice(-4)}`;

export const GeminiKeyModal: React.FC<GeminiKeyModalProps> = ({ isOpen, onClose, onConnected }) => {
  const [profiles, setProfiles] = useState<GeminiKeyProfile[]>([]);
  const [activeId, setActiveId] = useState('');
  const [name, setName] = useState('');
  const [inputKey, setInputKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberOption, setRememberOption] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [modalError, setModalError] = useState('');

  const refresh = () => {
    const next = getStoredApiKeys();
    setProfiles(next);
    setActiveId(getStoredApiKey().id || '');
    return next;
  };

  useEffect(() => {
    if (!isOpen) return;
    refresh(); setName(''); setInputKey(''); setModalError(''); setShowPassword(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConnect = async () => {
    const clean = inputKey.trim();
    if (!clean) { setModalError('Vui lòng nhập Gemini API Key.'); return; }
    setIsValidating(true); setModalError('');
    try {
      const result = await validateGeminiApiKey(clean);
      if (!result.success) { setModalError(result.message); return; }
      const profile = saveStoredApiKey(clean, rememberOption, name);
      if (!profile) { setModalError('Không thể lưu API Key trên trình duyệt này.'); return; }
      const next = refresh();
      onConnected(profile, next.length);
      setName(''); setInputKey('');
    } catch (error) {
      setModalError(`Không thể xác thực: ${error instanceof Error ? error.message : 'Lỗi mạng'}`);
    } finally { setIsValidating(false); }
  };

  const handleSelect = (profile: GeminiKeyProfile) => {
    setActiveStoredApiKey(profile.id); setActiveId(profile.id); onConnected(profile, profiles.length);
  };

  const handleRemove = (id: string) => {
    const nextInfo = removeStoredApiKey(id);
    const next = refresh();
    const active = next.find((profile) => profile.id === nextInfo.id);
    if (active) onConnected(active, next.length);
  };

  return <div className="key-modal-backdrop" role="dialog" aria-modal="true" aria-label="Quản lý Gemini API Key">
    <section className="key-modal">
      <header><div><h3>QUẢN LÝ GEMINI API KEY</h3><p>Lưu nhiều key có tên riêng. Khi key đang dùng hết quota hoặc không còn hợp lệ, ứng dụng tự thử key tiếp theo.</p></div><button type="button" onClick={onClose} aria-label="Đóng">×</button></header>

      {profiles.length > 0 && <div className="key-profile-list"><strong>Danh sách key ({profiles.length})</strong>{profiles.map((profile) => <article className={profile.id === activeId ? 'active' : ''} key={profile.id}><button type="button" className="key-profile-select" onClick={() => handleSelect(profile)}><i /> <span><b>{profile.name}</b><small>{maskKey(profile.key)} · {profile.type === 'local' ? 'Lưu trên thiết bị' : 'Trong phiên này'}</small></span></button><button type="button" className="key-delete" onClick={() => handleRemove(profile.id)}>Xóa</button></article>)}</div>}

      <div className="key-add-form"><strong>Thêm API Key</strong><label>Tên dễ nhớ<input type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder={`Ví dụ: Key công việc ${profiles.length + 1}`} disabled={isValidating} /></label><label>Gemini API Key<div className="key-secret-input"><input type={showPassword ? 'text' : 'password'} value={inputKey} onChange={(event) => setInputKey(event.target.value)} placeholder="Nhập AIzaSy..." autoComplete="off" spellCheck="false" disabled={isValidating} /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Ẩn' : 'Hiện'}</button></div></label><div className="key-storage-options"><label><input type="radio" name="keyStorage" checked={!rememberOption} onChange={() => setRememberOption(false)} /><span><b>Chỉ dùng trong phiên này</b><small>Tự xóa khi đóng tab.</small></span></label><label><input type="radio" name="keyStorage" checked={rememberOption} onChange={() => setRememberOption(true)} /><span><b>Ghi nhớ trên thiết bị này</b><small>Chỉ dùng trên thiết bị cá nhân.</small></span></label></div></div>

      {modalError && <div className="key-modal-error">{modalError}</div>}
      <a className="key-help" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Lấy Gemini Key tại Google AI Studio ↗</a>
      <footer><button type="button" className="secondary" onClick={onClose} disabled={isValidating}>Đóng</button><button type="button" className="primary" onClick={handleConnect} disabled={isValidating}>{isValidating ? 'Đang kiểm tra…' : 'Kiểm tra & Thêm key'}</button></footer>
    </section>
  </div>;
};
