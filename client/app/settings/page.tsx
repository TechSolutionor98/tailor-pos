'use client';

import { useEffect, useState } from 'react';
import { Card, Field, NumberInput, SectionTitle, TextInput } from '@/components/ui';
import { useSettings } from '@/components/SettingsContext';
import { LogoField } from '@/components/LogoField';
import { useToast } from '@/components/Toast';
import { num } from '@/lib/format';
import type { AppSettings } from '@/lib/types';

export default function SettingsPage() {
  const { toast } = useToast();
  const { settings, save } = useSettings();
  const [form, setForm] = useState({ ...settings });

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  function update<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  /** Edits one field inside the company or bank block. */
  function updateCompany<K extends keyof AppSettings['company']>(k: K, v: string) {
    setForm((f) => ({ ...f, company: { ...f.company, [k]: v } }));
  }
  function updateBank<K extends keyof AppSettings['bank']>(k: K, v: string) {
    setForm((f) => ({ ...f, bank: { ...f.bank, [k]: v } }));
  }

  /** Trims every value of a flat block of text fields, keeping its shape. */
  const trim = <T extends object>(o: T): T =>
    Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, String(v ?? '').trim()]),
    ) as T;

  function onSave() {
    const cleaned: AppSettings = {
      taxRate: num(form.taxRate, 5),
      bookNo: Math.round(num(form.bookNo, 270)),
      salesman: String(form.salesman || 'GENERAL').toUpperCase(),
      deliveryDays: Math.round(num(form.deliveryDays, 7)),
      // The logos are left alone: a data URI must not be trimmed field by
      // field like a line of text, and there is no whitespace in one anyway.
      company: { ...trim(form.company), logo: form.company.logo, brandLogo: form.company.brandLogo },
      bank: trim(form.bank),
      invoiceTitle: String(form.invoiceTitle || '').trim() || 'Stitching Order',
    };
    save(cleaned);
    setForm(cleaned);
    toast('Settings saved');
  }

  return (
    <div className="max-w-2xl">
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Defaults used across stitching orders and bills. Stored on this device.</p>

      <Card className="mt-3 p-6">
        <SectionTitle title="Business Defaults" sub="Applied to new stitching orders and sales bills" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="VAT / Tax Rate (%)">
            <NumberInput
              value={String(form.taxRate)}
              onChange={(e) => update('taxRate', Number(e.target.value))}
            />
          </Field>
          <Field label="Default Book No">
            <NumberInput
              value={String(form.bookNo)}
              onChange={(e) => update('bookNo', Number(e.target.value))}
            />
          </Field>
          <Field label="Default Salesman">
            <TextInput value={form.salesman} onChange={(e) => update('salesman', e.target.value)} />
          </Field>
          <Field label="Delivery Days (default)">
            <NumberInput
              value={String(form.deliveryDays)}
              onChange={(e) => update('deliveryDays', Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="mt-6 flex justify-end">
          <button className="btn-primary" onClick={onSave}>
            Save Settings
          </button>
        </div>
      </Card>

      <Card className="mt-3 p-6">
        <SectionTitle
          title="Invoice Details"
          sub="Printed at the head of every order invoice"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <LogoField
            label="Logo"
            hint="Shown at the top left. A PNG with a transparent background prints best."
            value={form.company.logo}
            onChange={(v) => updateCompany('logo', v)}
          />
          <Field label="Company Name" className="sm:col-span-2">
            <TextInput
              value={form.company.name}
              onChange={(e) => updateCompany('name', e.target.value)}
              placeholder="e.g. AL FAHAD TAILORING LLC"
            />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <TextInput
              value={form.company.address}
              onChange={(e) => updateCompany('address', e.target.value)}
              placeholder="Dubai, United Arab Emirates"
            />
          </Field>
          <Field label="Mobile">
            <TextInput
              value={form.company.phone}
              onChange={(e) => updateCompany('phone', e.target.value)}
              placeholder="+971 50 000 0000"
              className="font-mono"
            />
          </Field>
          <Field label="Email">
            <TextInput
              value={form.company.email}
              onChange={(e) => updateCompany('email', e.target.value)}
              placeholder="orders@example.com"
            />
          </Field>
          <Field label="Website">
            <TextInput
              value={form.company.website}
              onChange={(e) => updateCompany('website', e.target.value)}
              placeholder="https://example.com"
            />
          </Field>
          <Field label="TRN">
            <TextInput
              value={form.company.trn}
              onChange={(e) => updateCompany('trn', e.target.value)}
              placeholder="Tax registration number"
              className="font-mono"
            />
          </Field>
          <LogoField
            label="Second Logo (optional)"
            hint="Shown at the top right, for a sub-brand. Leave it empty and that corner stays clear."
            value={form.company.brandLogo}
            onChange={(v) => updateCompany('brandLogo', v)}
          />
          <Field label="Second Logo Caption" className="sm:col-span-2">
            <TextInput
              value={form.company.brandTagline}
              onChange={(e) => updateCompany('brandTagline', e.target.value)}
              placeholder="e.g. A Brand By Crown Excel"
            />
          </Field>
        </div>
      </Card>

      <Card className="mt-3 p-6">
        <SectionTitle
          title="Bank Details"
          sub="Printed at the foot of the invoice, so a customer can transfer"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Bank Name">
            <TextInput
              value={form.bank.name}
              onChange={(e) => updateBank('name', e.target.value)}
              placeholder="e.g. First Abu Dhabi Bank"
            />
          </Field>
          <Field label="Account Type">
            <TextInput
              value={form.bank.accountType}
              onChange={(e) => updateBank('accountType', e.target.value)}
              placeholder="AED ACCOUNT"
            />
          </Field>
          <Field label="Account Name" className="sm:col-span-2">
            <TextInput
              value={form.bank.accountName}
              onChange={(e) => updateBank('accountName', e.target.value)}
            />
          </Field>
          <Field label="Account Number">
            <TextInput
              value={form.bank.accountNo}
              onChange={(e) => updateBank('accountNo', e.target.value)}
              className="font-mono"
            />
          </Field>
          <Field label="IBAN">
            <TextInput
              value={form.bank.iban}
              onChange={(e) => updateBank('iban', e.target.value.toUpperCase())}
              className="font-mono"
            />
          </Field>
          <Field label="SWIFT Code">
            <TextInput
              value={form.bank.swift}
              onChange={(e) => updateBank('swift', e.target.value.toUpperCase())}
              className="font-mono"
            />
          </Field>
          <Field label="Cheques in Favour of">
            <TextInput
              value={form.bank.chequeFavour}
              onChange={(e) => updateBank('chequeFavour', e.target.value)}
            />
          </Field>
          <Field label="Footer Note" className="sm:col-span-2">
            <TextInput
              value={form.bank.note}
              onChange={(e) => updateBank('note', e.target.value)}
              placeholder="Mention the invoice number when making the transfer."
            />
          </Field>
        </div>
        <div className="mt-6 flex justify-end">
          <button className="btn-primary" onClick={onSave}>
            Save Settings
          </button>
        </div>
      </Card>

      <Card className="mt-3 p-6">
        <SectionTitle title="API Connection" sub="Where the app reads and writes data" />
        <Field label="API Base URL">
          <TextInput
            value={process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api (default)'}
            readOnly
            className="bg-ink-50 font-mono text-xs"
          />
        </Field>
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          To point the app at a different server, set <code className="rounded bg-ink-100 px-1 font-mono">NEXT_PUBLIC_API_URL</code> in{' '}
          <code className="rounded bg-ink-100 px-1 font-mono">client/.env.local</code> and restart the dev server.
        </p>
      </Card>
    </div>
  );
}
