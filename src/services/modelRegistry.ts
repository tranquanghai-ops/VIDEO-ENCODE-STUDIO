/**
 * modelRegistry.ts
 * Quản lý danh mục mô hình Gemini (Model Registry) tập trung cho TDTU-TKNT.
 * 
 * NGUYÊN TẮC VÀ YÊU CẦU:
 * 1. Chỉ giữ các mô hình:
 *    - Đang hoạt động
 *    - Gemini Developer API hỗ trợ
 *    - Có Free Tier (không yêu cầu billing)
 *    - Hỗ trợ AUDIO INPUT
 *    - Hỗ trợ Structured JSON output
 * 2. ĐÃ LOẠI BỎ TRIỆT ĐỂ các mô hình đã ngừng hoạt động (shutdown/deprecated).
 * 3. Chế độ Tự động (AUTO) ưu tiên các mô hình Gemini 3.x Flash mới nhất và ổn định nhất.
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
 * Danh mục mô hình Gemini chính thức đáp ứng đầy đủ tiêu chí:
 * Hoạt động + Free Tier + Hỗ trợ Audio Input + Structured Output
 */
export const GEMINI_MODEL_REGISTRY: GeminiModelInfo[] = [
  {
    modelId: 'gemini-3.8-flash',
    displayName: 'Gemini 3.8 Flash (Mới nhất)',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 100,
    description: 'Mô hình Flash mới nhất (09/2026), xử lý đa phương thức và nhận diện âm thanh xuất sắc nhất (Khuyên dùng)'
  },
  {
    modelId: 'gemini-3.7-flash',
    displayName: 'Gemini 3.7 Flash',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 90,
    description: 'Mô hình ổn định cao thế hệ 3.7, tối ưu hóa suy luận và tuân thủ định dạng SRT/JSON'
  },
  {
    modelId: 'gemini-3.6-flash',
    displayName: 'Gemini 3.6 Flash',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 80,
    description: 'Mô hình Flash thế hệ 3.6, hiệu suất xử lý âm thanh tốc độ cao'
  },
  {
    modelId: 'gemini-3.5-flash',
    displayName: 'Gemini 3.5 Flash',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 70,
    description: 'Mô hình Flash thế hệ 3.5 ổn định đa phương tiện'
  },
  {
    modelId: 'gemini-3.5-flash-lite',
    displayName: 'Gemini 3.5 Flash-Lite',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 65,
    description: 'Mô hình siêu nhẹ thế hệ 3.5, tốc độ 350 tokens/s, tối ưu lượt dùng Free Tier'
  },
  {
    modelId: 'gemini-3.1-flash-lite',
    displayName: 'Gemini 3.1 Flash-Lite',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 60,
    description: 'Mô hình gọn nhẹ thế hệ 3.1, thích hợp xử lý phụ đề và dịch thuật số lượng lớn'
  },
  {
    modelId: 'gemini-2.5-flash',
    displayName: 'Gemini 2.5 Flash',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 50,
    description: 'Mô hình Flash thế hệ 2.5 dự phòng ổn định'
  },
  {
    modelId: 'gemini-2.5-flash-lite',
    displayName: 'Gemini 2.5 Flash-Lite',
    audioSupported: true,
    freeTierVerified: true,
    stable: true,
    deprecated: false,
    priority: 40,
    description: 'Mô hình Flash-Lite thế hệ 2.5 dự phòng nhẹ'
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
