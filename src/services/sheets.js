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

// date: optional "DD/MM/YYYY" string, defaults to current month
function getSheetTitle(date) {
  if (date) {
    const parts = date.split('/');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${month}/${year}`;
  }
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = now.getFullYear();
  return `${month}/${year}`;
}

async function getSheet(date) {
  const doc = await getDoc();
  const title = getSheetTitle(date);
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
  const errors = [];
  const valid = [];

  for (const expense of expenses) {
    // Parse date "DD/MM/YYYY"
    const parts = expense.date.split('/');
    if (parts.length !== 3) {
      errors.push(`Ngày không hợp lệ: "${expense.date}" cho "${expense.description}"`);
      continue;
    }
    const day = parseInt(parts[0], 10);
    if (isNaN(day) || day < 1 || day > 31) {
      errors.push(`Ngày không hợp lệ: "${expense.date}" cho "${expense.description}"`);
      continue;
    }
    const sheetTitle = getSheetTitle(expense.date);
    valid.push({ ...expense, day, rowIndex: day + 1, sheetTitle });
  }

  if (valid.length === 0 && errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  // Group by sheet tab (month/year)
  const groups = {};
  for (const expense of valid) {
    if (!groups[expense.sheetTitle]) groups[expense.sheetTitle] = [];
    groups[expense.sheetTitle].push(expense);
  }

  const recorded = [];

  for (const [sheetTitle, groupExpenses] of Object.entries(groups)) {
    const sheet = await getSheet(groupExpenses[0].date);
    await sheet.loadHeaderRow();
    const headers = sheet.headerValues;

    // Build map: categoryName -> columnIndex
    const categoryMap = {};
    for (let i = 1; i < headers.length; i++) {
      if (headers[i]) categoryMap[headers[i]] = i;
    }

    // Validate categories and assign colIndex
    const sheetValid = [];
    for (const expense of groupExpenses) {
      const colIndex = categoryMap[expense.category];
      if (colIndex === undefined) {
        errors.push(
          `Category "${expense.category}" không có trên sheet. Các category có sẵn: ${Object.keys(categoryMap).join(', ')}`
        );
        continue;
      }
      sheetValid.push({ ...expense, colIndex });
    }

    if (sheetValid.length === 0) continue;

    // Load needed cells
    const minRow = Math.min(...sheetValid.map((e) => e.rowIndex));
    const maxRow = Math.max(...sheetValid.map((e) => e.rowIndex));
    const minCol = Math.min(...sheetValid.map((e) => e.colIndex));
    const maxCol = Math.max(...sheetValid.map((e) => e.colIndex));
    await sheet.loadCells({
      startRowIndex: minRow,
      endRowIndex: maxRow + 1,
      startColumnIndex: minCol,
      endColumnIndex: maxCol + 1,
    });

    for (const expense of sheetValid) {
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
    logger.info(`Recorded ${sheetValid.length} expense(s) to sheet "${sheetTitle}"`);
  }

  return { recorded, errors };
}
