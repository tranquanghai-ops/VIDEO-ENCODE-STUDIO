/**
 * modelRegistry.ts
 * Quản lý danh mục mô hình Gemini (Model Registry) tập trung cho TDTU-TKNT.
 * 
 * NGUYÊN TẮC:
 * 1. Chỉ đưa các mô hình đã xác minh hoạt động, hỗ trợ Audio, có Free Tier vào nhóm Free.
 * 2. Tuyệt đối KHÔNG đưa model Paid-only vào chế độ Tự động (AUTO).
 * 3. Chế độ Tự động ưu tiên mô hình Free phù hợp nhất, tự động fallback nếu model không khả dụng.
 * 4. Thay đổi danh mục mô hình chỉ cần cập nhật DUY NHẤT tại tệp này.
 */

export interface GeminiModelInfo {
  modelId: string;
  displayName: string;
  audioSupported: boolean;
  freeTierVerified: boolean;
  stable: boolean;
  deprecated: boolean;
  priority: number; // Số càng lớn -> Độ ưu tiên càng cao cho AUTO
  description: string;
}

/**
 * Danh mục mô hình Gemini chính thức có hỗ trợ đầu vào Audio và có Free Tier
 */
export const GEMINI_MODEL_REGISTRY: GeminiModelInfo[] = [
  {
    modelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 100,
    description: 'Mô hình Flash mới nhất, tốc độ cao, nhận diện âm thanh xuất sắc (Khuyên dùng)'
  },
  {
    modelId: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash-Lite',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 90,
    description: 'Mô hình siêu nhẹ, độ trễ thấp, tối ưu hóa lượt dùng cho Free Tier'
  },
  {
    modelId: 'gemini-2.0-flash',
    displayName: 'Gemini 2.0 Flash',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 80,
    description: 'Mô hình Flash đa phương tiện ổn định'
  },
  {
    modelId: 'gemini-2.0-flash-lite',
    displayName: 'Gemini 2.0 Flash-Lite',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 70,
    description: 'Mô hình nhẹ thế hệ 2.0, tiết kiệm tài nguyên'
  }
];

export const AUTO_MODEL_ID = 'auto';

/**
 * Lấy danh sách các mô hình Free Tier khả dụng đã lọc bỏ các mô hình bị ngừng (deprecated)
 */
export function getAvailableFreeModels(): GeminiModelInfo[] {
  return GEMINI_MODEL_REGISTRY.filter(
    (m) => m.freeTierVerified && m.audioSupported && !m.deprecated
  ).sort((a, b) => b.priority - a.priority);
}

/**
 * Lấy danh sách model ID theo thứ tự ưu tiên dùng cho chế độ AUTO/fallback
 */
export function getAutoModelFallbackChain(): string[] {
  return getAvailableFreeModels().map((m) => m.modelId);
}

/**
 * Lấy thông tin chi tiết một mô hình theo ID
 */
export function getModelInfo(modelId: string): GeminiModelInfo | undefined {
  return GEMINI_MODEL_REGISTRY.find((m) => m.modelId === modelId);
}
