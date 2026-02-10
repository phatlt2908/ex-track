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

  const day = new Date().getDate();
  const rowIndex = day + 1; // row 0 = header, row 1 = extra row, row 2 = day 1, etc.

  // Find all columns we need to update
  const columnsToUpdate = new Set();
  const errors = [];

  for (const expense of expenses) {
    const colIndex = categoryMap[expense.category];
    if (colIndex === undefined) {
      errors.push(
        `Category "${expense.category}" không có trên sheet. Các category có sẵn: ${Object.keys(categoryMap).join(', ')}`
      );
      continue;
    }
    columnsToUpdate.add(colIndex);
  }

  if (errors.length > 0 && columnsToUpdate.size === 0) {
    throw new Error(errors.join('\n'));
  }

  // Load the target row cells
  const minCol = Math.min(...columnsToUpdate);
  const maxCol = Math.max(...columnsToUpdate);
  await sheet.loadCells({
    startRowIndex: rowIndex,
    endRowIndex: rowIndex + 1,
    startColumnIndex: minCol,
    endColumnIndex: maxCol + 1,
  });

  const recorded = [];

  for (const expense of expenses) {
    const colIndex = categoryMap[expense.category];
    if (colIndex === undefined) continue;

    const cell = sheet.getCell(rowIndex, colIndex);
    const amount = expense.amount;
    const description = expense.description;

    if (cell.value === null || cell.value === '') {
      // Empty cell
      cell.value = amount;
      cell.note = description;
    } else if (cell.formula) {
      // Cell has formula: append + newAmount
      cell.formula = `${cell.formula} + ${amount}`;
      cell.note = cell.note ? `${cell.note}, ${description}` : description;
    } else {
      // Cell has a plain number: convert to formula
      cell.formula = `= ${cell.value} + ${amount}`;
      cell.note = cell.note ? `${cell.note}, ${description}` : description;
    }

    recorded.push(expense);
  }

  await sheet.saveUpdatedCells();
  logger.info(`Recorded ${recorded.length} expense(s) to sheet`);

  return { recorded, errors };
}
