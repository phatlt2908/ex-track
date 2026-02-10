import TelegramBot from 'node-telegram-bot-api';
import { config } from '../config/env.js';
import { parseExpense } from '../services/ai-parser.js';
import { recordExpense } from '../services/sheets.js';
import { logger } from '../utils/logger.js';

function formatAmount(amount) {
  return amount.toLocaleString('vi-VN') + 'đ';
}

function buildConfirmation(recorded) {
  const day = new Date().getDate();
  const lines = recorded.map(
    (e) => `• ${e.description} - ${formatAmount(e.amount)} | ${e.category}`
  );
  return `Đã ghi (ngày ${day}):\n${lines.join('\n')}`;
}

export function startBot() {
  const bot = new TelegramBot(config.telegramToken, { polling: true });
  logger.info('Telegram bot started (long polling)');

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      'Chào! Gửi tin nhắn chi tiêu để ghi vào sheet.\nVí dụ: "ăn phở 50k" hoặc "grab 25k, cà phê 30k"\n\nGõ /help để xem hướng dẫn.'
    );
  });

  bot.onText(/\/help/, (msg) => {
    bot.sendMessage(
      msg.chat.id,
      [
        'Hướng dẫn sử dụng:',
        '• Gửi chi tiêu: "ăn phở 50k"',
        '• Nhiều khoản: "ăn trưa 60k, grab 25k"',
        '• Viết tắt: k = nghìn, tr = triệu',
        '• Category được tự động nhận diện từ sheet',
      ].join('\n')
    );
  });

  bot.on('message', async (msg) => {
    // Ignore non-text messages
    if (!msg.text) return;

    // Ignore commands (handled by onText above)
    if (msg.text.startsWith('/')) return;

    const statusMsg = await bot.sendMessage(msg.chat.id, 'Đang xử lý...');

    try {
      const expenses = await parseExpense(msg.text);
      const { recorded, errors } = await recordExpense(expenses);

      let reply = '';

      if (recorded.length > 0) {
        reply = buildConfirmation(recorded);
      }

      if (errors.length > 0) {
        reply += (reply ? '\n\n' : '') + 'Lỗi:\n' + errors.join('\n');
      }

      await bot.editMessageText(reply, {
        chat_id: msg.chat.id,
        message_id: statusMsg.message_id,
      });
    } catch (err) {
      logger.error('Error processing message:', err.message, err);
      await bot.editMessageText(`Lỗi: ${err.message}`, {
        chat_id: msg.chat.id,
        message_id: statusMsg.message_id,
      });
    }
  });

  bot.on('polling_error', (err) => {
    logger.error('Polling error:', err.message);
  });

  return bot;
}
