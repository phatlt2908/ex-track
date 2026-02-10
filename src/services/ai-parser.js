import { config } from '../config/env.js';
import { getCategories } from './sheets.js';
import { logger } from '../utils/logger.js';

let cachedCategories = null;
let categoriesCachedAt = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getCachedCategories() {
  const now = Date.now();
  if (cachedCategories && now - categoriesCachedAt < CACHE_TTL) {
    return cachedCategories;
  }
  cachedCategories = await getCategories();
  categoriesCachedAt = now;
  logger.info(`Refreshed categories: ${cachedCategories.join(', ')}`);
  return cachedCategories;
}

function buildSystemPrompt(categories) {
  const now = new Date();
  const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  const today = fmt(now);
  const yesterday = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const weekday = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'][now.getDay()];

  return `Bạn là trợ lý phân tích chi tiêu. Nhiệm vụ: parse tin nhắn tiếng Việt thành danh sách chi tiêu.

Hôm nay là ${weekday}, ngày ${today}.

Quy tắc:
- "k" hoặc "K" = x1.000 (ví dụ: 50k = 50000)
- "tr" = x1.000.000 (ví dụ: 1.5tr = 1500000)
- Một tin nhắn có thể chứa nhiều khoản chi tiêu, phân tách bởi dấu phẩy hoặc xuống dòng
- Trả về amount là số nguyên (không có dấu chấm/phẩy)
- description là mô tả ngắn gọn của khoản chi
- date: ngày chi tiêu, format "DD/MM/YYYY". Xác định dựa trên ngữ cảnh:
  + Không nói gì về ngày → dùng ngày hôm nay
  + "hôm qua" → ngày hôm nay - 1
  + "hôm kia" → ngày hôm nay - 2
  + "thứ X tuần trước" → tính ngày cụ thể
  + "ngày 9/2" → 09/02 năm hiện tại

Danh sách category có sẵn: ${categories.join(', ')}

- Chọn category phù hợp nhất từ danh sách trên
- Nếu không rõ category nào phù hợp, dùng "Khác"
- CHỈ được dùng category có trong danh sách trên

Ví dụ:
- "ăn phở 50k" → [{description: "ăn phở", amount: 50000, category: "Ăn uống", date: "${today}"}]
- "hôm qua grab 25k, cà phê 30k" → [{description: "grab", amount: 25000, category: "Đi lại", date: "${yesterday}"}, {description: "cà phê", amount: 30000, category: "Ăn uống", date: "${yesterday}"}]
- QUAN TRỌNG: date luôn phải là ngày cụ thể format DD/MM/YYYY, KHÔNG được trả về text như "hôm qua", "thứ 6 tuần trước"`;
}

const jsonSchema = {
  name: 'expenses',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      expenses: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            description: { type: 'string' },
            amount: { type: 'number' },
            category: { type: 'string' },
            date: { type: 'string' },
          },
          required: ['description', 'amount', 'category', 'date'],
          additionalProperties: false,
        },
      },
    },
    required: ['expenses'],
    additionalProperties: false,
  },
};

export async function parseExpense(text) {
  const categories = await getCachedCategories();
  const systemPrompt = buildSystemPrompt(categories);

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openrouterApiKey}`,
    },
    body: JSON.stringify({
      model: config.openrouterModel,
      temperature: 0.1,
      response_format: { type: 'json_schema', json_schema: jsonSchema },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter API error ${response.status}: ${body}`);
  }

  const data = await response.json();
  logger.info(`OpenRouter response: model=${data.model}, usage=${JSON.stringify(data.usage)}`);
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('AI không trả về kết quả');
  }

  const parsed = JSON.parse(content);

  if (!parsed.expenses || parsed.expenses.length === 0) {
    throw new Error('Không hiểu tin nhắn. Hãy thử lại, ví dụ: "ăn phở 50k"');
  }

  logger.info(`Parsed ${parsed.expenses.length} expense(s) from: "${text}"`);
  return parsed.expenses;
}
