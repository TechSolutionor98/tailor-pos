import { Router } from 'express';
import { Setting } from '../models/Setting';
import { asyncHandler } from '../middleware';
import { requireAuth, requirePerm } from '../auth/guard';

export const settingsRouter = Router();

// GET /api/settings - retrieve business settings (open so invoices & headers can display business info)
settingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    let s = await Setting.findOne({ key: 'global' });
    if (!s) {
      s = await Setting.create({ key: 'global' });
    }
    res.json({
      taxRate: s.taxRate,
      bookNo: s.bookNo,
      salesman: s.salesman,
      deliveryDays: s.deliveryDays,
      company: s.company,
      bank: s.bank,
      invoiceTitle: s.invoiceTitle,
    });
  }),
);

// PUT /api/settings - update business settings (requires settings.manage permission)
settingsRouter.put(
  '/',
  requireAuth,
  requirePerm('settings.manage'),
  asyncHandler(async (req, res) => {
    const body = req.body;
    let s = await Setting.findOne({ key: 'global' });
    if (!s) {
      s = new Setting({ key: 'global' });
    }

    if (body.taxRate !== undefined) s.taxRate = Number(body.taxRate) || 0;
    if (body.bookNo !== undefined) s.bookNo = Math.round(Number(body.bookNo)) || 0;
    if (body.salesman !== undefined) s.salesman = String(body.salesman).toUpperCase();
    if (body.deliveryDays !== undefined) s.deliveryDays = Math.round(Number(body.deliveryDays)) || 0;
    if (body.invoiceTitle !== undefined) s.invoiceTitle = String(body.invoiceTitle);

    if (body.company && typeof body.company === 'object') {
      s.company = {
        name: String(body.company.name ?? '').trim(),
        address: String(body.company.address ?? '').trim(),
        phone: String(body.company.phone ?? '').trim(),
        email: String(body.company.email ?? '').trim(),
        website: String(body.company.website ?? '').trim(),
        trn: String(body.company.trn ?? '').trim(),
        logo: String(body.company.logo ?? ''),
        brandLogo: String(body.company.brandLogo ?? ''),
        brandTagline: String(body.company.brandTagline ?? '').trim(),
      };
    }

    if (body.bank && typeof body.bank === 'object') {
      s.bank = {
        name: String(body.bank.name ?? '').trim(),
        accountType: String(body.bank.accountType ?? '').trim(),
        accountName: String(body.bank.accountName ?? '').trim(),
        accountNo: String(body.bank.accountNo ?? '').trim(),
        iban: String(body.bank.iban ?? '').trim().toUpperCase(),
        swift: String(body.bank.swift ?? '').trim().toUpperCase(),
        chequeFavour: String(body.bank.chequeFavour ?? '').trim(),
        note: String(body.bank.note ?? '').trim(),
      };
    }

    await s.save();

    res.json({
      taxRate: s.taxRate,
      bookNo: s.bookNo,
      salesman: s.salesman,
      deliveryDays: s.deliveryDays,
      company: s.company,
      bank: s.bank,
      invoiceTitle: s.invoiceTitle,
    });
  }),
);
