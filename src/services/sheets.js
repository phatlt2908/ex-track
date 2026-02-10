import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { config } from '../config/env.js';
import { logger } from '../utils/logger.js';

let cachedDoc = null;

function getAuth() {
  return new JWT({
    email: config.googleServiceAccountEmail,
    key: config.googlePrivateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getDoc() {
  if (cachedDoc) return cachedDoc;

  const year = new Date().getFullYear();
  const spreadsheetId = config.getSpreadsheetId(year);
  const doc = new GoogleSpreadsheet(spreadsheetId, getAuth());
  await doc.loadInfo();
  cachedDoc = doc;
  logger.info(`Loaded spreadsheet: ${doc.title}`);
  return doc;
}

function getSheetTitle() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${month}/${year}`;
}

async function getSheet() {
  const doc = await getDoc();
  const title = getSheetTitle();
  const sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    throw new Error(`Sheet tab "${title}" không tồn tại. Hãy tạo tab "${title}" trên Google Sheet.`);
  }
  return sheet;
}

export async function getCategories() {
  const sheet = await getSheet();
  await sheet.loadHeaderRow();
  // Skip first column (assumed to be date/day label)
  return sheet.headerValues.slice(1).filter(Boolean);
}

export async function recordExpense(expenses) {
  const sheet = await getSheet();
  await sheet.loadHeaderRow();
  const headers = sheet.headerValues;

  // Build map: categoryName -> columnIndex
  const categoryMap = {};
  for (let i = 1; i < headers.length; i++) {
    if (headers[i]) {
      categoryMap[headers[i]] = i;
    }
  }

  // Group expenses by date to batch cell loading
  const errors = [];
  const valid = [];

  for (const expense of expenses) {
    const colIndex = categoryMap[expense.category];
    if (colIndex === undefined) {
      errors.push(
        `Category "${expense.category}" không có trên sheet. Các category có sẵn: ${Object.keys(categoryMap).join(', ')}`
      );
      continue;
    }
    // Parse date "DD/MM/YYYY" to get day
    const [dayStr] = expense.date.split('/');
    const day = parseInt(dayStr, 10);
    if (isNaN(day) || day < 1 || day > 31) {
      errors.push(`Ngày không hợp lệ: "${expense.date}" cho "${expense.description}"`);
      continue;
    }
    valid.push({ ...expense, colIndex, day, rowIndex: day + 1 });
  }

  if (valid.length === 0 && errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  // Load all needed cells (may span multiple rows)
  const minRow = Math.min(...valid.map((e) => e.rowIndex));
  const maxRow = Math.max(...valid.map((e) => e.rowIndex));
  const minCol = Math.min(...valid.map((e) => e.colIndex));
  const maxCol = Math.max(...valid.map((e) => e.colIndex));
  await sheet.loadCells({
    startRowIndex: minRow,
    endRowIndex: maxRow + 1,
    startColumnIndex: minCol,
    endColumnIndex: maxCol + 1,
  });

  const recorded = [];

  for (const expense of valid) {
    const cell = sheet.getCell(expense.rowIndex, expense.colIndex);
    const amount = expense.amount;
    const description = expense.description;

    if (cell.value === null || cell.value === '') {
      cell.value = amount;
      cell.note = description;
    } else if (cell.formula) {
      cell.formula = `${cell.formula} + ${amount}`;
      cell.note = cell.note ? `${cell.note}, ${description}` : description;
    } else {
      cell.formula = `= ${cell.value} + ${amount}`;
      cell.note = cell.note ? `${cell.note}, ${description}` : description;
    }

    recorded.push(expense);
  }

  await sheet.saveUpdatedCells();
  logger.info(`Recorded ${recorded.length} expense(s) to sheet`);

  return { recorded, errors };
}
