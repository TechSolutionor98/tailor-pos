'use client';

import { fmt, fmtDate } from '@/lib/format';
import { amountInWords } from '@/lib/words';
import { formatAddress, type AppSettings, type Ledger, type Sale } from '@/lib/types';

/**
 * A sale's tax invoice, laid out to be printed with the exact same
 * bilingual format, letterhead, and styling as the Stitching Order invoice.
 * Heading displays "TAX INVOICE" as requested.
 */

const GREEN = '#5b7f27';
const RULE = '#8fb858';
const CELL = '#c3d9a0';

/** One row of the box under the masthead: English, the value, then Arabic. */
function DetailRow({
  en,
  ar,
  value,
  wide = false,
}: {
  en: string;
  ar: string;
  value?: string;
  wide?: boolean;
}) {
  return (
    <tr>
      <td className="whitespace-nowrap py-[2px] pr-2 align-top text-[7pt] font-bold uppercase text-neutral-700">
        {en}:
      </td>
      <td
        className={`py-[2px] pr-2 align-top text-[7.5pt] font-semibold [overflow-wrap:anywhere] ${
          wide ? '' : 'w-full'
        }`}
      >
        {value || '—'}
      </td>
      <td
        className="whitespace-nowrap py-[2px] align-top text-[7pt] text-neutral-600"
        dir="rtl"
      >
        {ar}
      </td>
    </tr>
  );
}

/** One figure in the totals block, laid out like the detail rows above it. */
function TotalRow({
  en,
  ar,
  value,
  highlightRed = false,
}: {
  en: string;
  ar: string;
  value: string;
  highlightRed?: boolean;
}) {
  return (
    <tr className={highlightRed ? 'border-t border-red-200 bg-red-50/50 print:[print-color-adjust:exact]' : ''}>
      <td
        className={`whitespace-nowrap py-[3px] pr-3 align-middle uppercase print:[print-color-adjust:exact] ${
          highlightRed
            ? 'text-[8.5pt] font-black text-red-600'
            : 'text-[7pt] font-bold text-neutral-700'
        }`}
      >
        {en}:
      </td>
      <td
        className={`w-full whitespace-nowrap py-[3px] pr-3 align-middle tabular-nums print:[print-color-adjust:exact] ${
          highlightRed
            ? 'text-[10pt] font-black text-red-600'
            : 'text-[7.5pt] font-bold text-neutral-900'
        }`}
      >
        {value}
      </td>
      <td
        className={`whitespace-nowrap py-[3px] align-middle print:[print-color-adjust:exact] ${
          highlightRed
            ? 'text-[8.5pt] font-bold text-red-600'
            : 'text-[7pt] text-neutral-600'
        }`}
        dir="rtl"
      >
        {ar}
      </td>
    </tr>
  );
}

/** A column heading, English over Arabic as the sheet writes them. */
function Head({ en, ar }: { en: string; ar: string }) {
  return (
    <>
      <span className="block">{en}</span>
      <span className="block font-normal" dir="rtl">
        {ar}
      </span>
    </>
  );
}

export function SaleInvoice({
  sale,
  settings,
  customer,
}: {
  sale: Sale;
  settings: AppSettings;
  /** Supplies address and email from the ledger if on file. */
  customer?: Ledger | null;
}) {
  const { company, bank } = settings;
  const rows = (sale.items ?? []).filter(
    (r) =>
      r.status !== 'pending' &&
      ((r.productName ?? '').trim() || (r.netAmount ?? 0) > 0),
  );

  const taxRate = settings.taxRate ?? 5;
  const taxable = Math.max(
    Math.round(
      ((sale.grossAmount || 0) + (sale.additionalCharges || 0) - (sale.discountAmt || 0)) * 100,
    ) / 100,
    0,
  );

  // Payment method formatting
  const method = sale.paymentMethod || sale.paymentType || 'cash';
  const paymentMethodLabel =
    method === 'bank'
      ? 'Bank Transfer'
      : method === 'card'
      ? 'Card'
      : method === 'split'
      ? 'Split Tender'
      : method === 'credit'
      ? 'Credit'
      : 'Cash';

  const cashPaid =
    sale.cashPaid != null && sale.cashPaid > 0
      ? sale.cashPaid
      : method === 'cash'
      ? sale.advanceAmount || 0
      : 0;
  const cardPaid =
    sale.cardPaid != null && sale.cardPaid > 0
      ? sale.cardPaid
      : method === 'card'
      ? sale.advanceAmount || 0
      : 0;
  const bankPaid =
    sale.bankPaid != null && sale.bankPaid > 0
      ? sale.bankPaid
      : method === 'bank'
      ? sale.advanceAmount || 0
      : 0;

  const bankLines = [
    bank.name && `BANK NAME: ${bank.name}`,
    bank.accountType && `ACCOUNT TYPE: ${bank.accountType}`,
    bank.accountName && `ACCOUNT NAME: ${bank.accountName}`,
    bank.accountNo && `ACCOUNT NUMBER: ${bank.accountNo}`,
    bank.iban && `IBAN NUMBER: ${bank.iban}`,
    bank.swift && `SWIFT CODE: ${bank.swift}`,
    bank.chequeFavour && `Cheques to be issued in Favour of "${bank.chequeFavour}"`,
    bank.note,
  ].filter(Boolean) as string[];

  const cell = { borderColor: CELL };

  return (
    <div className="mx-auto w-full max-w-[210mm] bg-white p-[10mm] text-[8pt] leading-snug text-neutral-900 print:max-w-none print:p-[8mm]">
      {/* masthead: the shop's mark, its details, and any second brand */}
      <div className="flex items-start justify-between gap-4">
        {company.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={company.logo}
            alt=""
            className="h-[16mm] w-[38mm] shrink-0 object-contain object-left"
          />
        ) : (
          <div className="w-[38mm] shrink-0" />
        )}

        <div className="min-w-0 flex-1 text-[7.5pt] leading-[1.45]">
          <p className="text-[8.5pt] font-bold uppercase">
            {company.name || 'Your company name — set it in Settings'}
          </p>
          {company.address && <p>{company.address}</p>}
          <p>
            {[company.phone && `Mobile: ${company.phone}`, company.email && `Email: ${company.email}`]
              .filter(Boolean)
              .join(' ')}
          </p>
          {company.website && <p>{company.website}</p>}
          {company.trn && <p className="font-bold">TRN: {company.trn}</p>}
        </div>

        {(company.brandLogo || company.brandTagline) && (
          <div className="w-[34mm] shrink-0 text-center">
            {company.brandLogo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={company.brandLogo}
                alt=""
                className="mx-auto h-[12mm] w-full object-contain"
              />
            )}
            {company.brandTagline && (
              <p className="mt-[1mm] text-[6pt] text-neutral-600">{company.brandTagline}</p>
            )}
          </div>
        )}
      </div>

      {/* what the sheet calls itself: TAX INVOICE as requested */}
      <div className="mt-[2mm] flex items-center justify-between">
        <p className="text-[11pt] font-bold text-[#e03131] tracking-wider print:[print-color-adjust:exact]">
          {sale.isReturn ? 'TAX INVOICE - RETURN' : 'TAX INVOICE'}
        </p>
        <span
          className={`rounded-md px-2 py-0.5 text-[8.5pt] font-black uppercase tracking-wider print:[print-color-adjust:exact] ${
            sale.isReturn
              ? 'bg-rose-100 text-rose-800 border border-rose-300'
              : sale.orderStatus === 'partially_ready'
                ? 'bg-blue-100 text-blue-800 border border-blue-300'
                : sale.orderStatus === 'open' || sale.orderStatus === 'pending'
                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                  : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
          }`}
        >
          {sale.isReturn
            ? 'RETURN'
            : sale.orderStatus
              ? sale.orderStatus.replace('_', ' ').toUpperCase()
              : sale.balance <= 0
                ? 'DELIVERED'
                : 'CREDIT / DUE'}
        </span>
      </div>
      <div
        className="mt-[1mm] h-[1.5px] w-full print:[print-color-adjust:exact]"
        style={{ backgroundColor: RULE }}
      />

      {/* who it is for, and which sale/invoice it is */}
      <div className="mt-[3mm] rounded-[3mm] bg-neutral-100 px-[4mm] py-[3mm] print:[print-color-adjust:exact]">
        <div className="grid grid-cols-2 gap-x-[6mm]">
          <table className="w-full border-collapse">
            <tbody>
              <DetailRow
                en="Cus Name"
                ar="اسم العميل"
                value={
                  customer?.invoiceOnCompanyName && customer.businessName
                    ? customer.businessName
                    : sale.partyName
                }
              />
              <DetailRow en="Phone" ar="رقم الهاتف" value={sale.phone || customer?.phone} />
              <DetailRow en="Email" ar="البريد الإلكتروني" value={customer?.email} />
            </tbody>
          </table>
          <table className="w-full border-collapse">
            <tbody>
              <DetailRow en="Inv No" ar="رقم الفاتورة" value={String(sale.billNo)} />
              <DetailRow
                en="Status"
                ar="الحالة"
                value={
                  sale.isReturn
                    ? 'Return'
                    : sale.orderStatus === 'partially_ready'
                      ? 'Partially Ready'
                      : sale.orderStatus === 'delivered'
                        ? 'Delivered'
                        : sale.orderStatus
                          ? sale.orderStatus.replace('_', ' ')
                          : 'Delivered'
                }
              />
              {sale.bookingNo && (
                <DetailRow en="Booking No" ar="رقم الحجز" value={String(sale.bookingNo)} />
              )}
              {sale.refNo && sale.refNo !== String(sale.billNo) && sale.refNo !== `B-${sale.billNo}` && (
                <DetailRow en="Ref No" ar="رقم المرجع" value={sale.refNo} />
              )}
              <DetailRow en="Date" ar="تاريخ الفاتورة" value={fmtDate(sale.billDate)} />
              <DetailRow en="Payment Method" ar="طريقة الدفع" value={paymentMethodLabel} />
            </tbody>
          </table>
        </div>
        {/* Address and delivery date */}
        <table className="w-full border-collapse">
          <tbody>
            <DetailRow en="Cus Add" ar="عنوان العميل" value={formatAddress(customer)} wide />
            {sale.delDate && (
              <DetailRow
                en="Delivery Date"
                ar="تاريخ التسليم"
                value={fmtDate(sale.delDate)}
                wide
              />
            )}
          </tbody>
        </table>
      </div>

      {/* what was ordered / sold */}
      <table className="mt-[3mm] w-full border-collapse">
        <thead>
          <tr
            className="text-white print:[print-color-adjust:exact]"
            style={{ backgroundColor: GREEN }}
          >
            <th
              className="w-[10mm] border border-white/40 px-[1.5mm] py-[2mm] text-center text-[7pt] font-bold uppercase"
              style={cell}
            >
              <Head en="S.NO" ar="الرقم" />
            </th>
            <th
              className="border border-white/40 px-[2mm] py-[2mm] text-center text-[7.5pt] font-bold uppercase"
              style={cell}
            >
              <Head en="PRODUCT NAME" ar="اسم المنتج" />
            </th>
            <th
              className="w-[20mm] border border-white/40 px-[1.5mm] py-[2mm] text-center text-[7pt] font-bold uppercase"
              style={cell}
            >
              <Head en="U.PRICE AED" ar="سعر الوحدة" />
            </th>
            <th
              className="w-[18mm] border border-white/40 px-[1.5mm] py-[2mm] text-center text-[7pt] font-bold uppercase"
              style={cell}
            >
              <Head en="QUANTITY" ar="الكمية" />
            </th>
            <th
              className="w-[24mm] border border-white/40 px-[1.5mm] py-[2mm] text-center text-[6.5pt] font-bold uppercase"
              style={cell}
            >
              <Head en="Total without vat" ar="الإجمالي" />
            </th>
            <th
              className="w-[22mm] border border-white/40 px-[1.5mm] py-[2mm] text-center text-[6.5pt] font-bold uppercase"
              style={cell}
            >
              <Head en="Vat Amount" ar="ضريبة" />
            </th>
            <th
              className="w-[24mm] border border-white/40 px-[1.5mm] py-[2mm] text-center text-[6.5pt] font-bold uppercase"
              style={cell}
            >
              <Head en="Total with vat" ar="الإجمالي مع الضريبة" />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="border px-[2mm] py-[6mm] text-center text-neutral-500"
                style={cell}
              >
                No items on this bill.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => {
              const lineTotalWithoutVat =
                r.grossAmt !== undefined && r.grossAmt !== null
                  ? r.grossAmt
                  : Math.round(r.qty * r.rate * 100) / 100;
              const lineVat =
                r.taxAmt !== undefined && r.taxAmt !== null
                  ? r.taxAmt
                  : Math.round(lineTotalWithoutVat * (taxRate / 100) * 100) / 100;
              const lineTotalWithVat =
                r.netAmount !== undefined && r.netAmount !== null
                  ? r.netAmount
                  : Math.round((lineTotalWithoutVat + lineVat) * 100) / 100;

              return (
                <tr key={i}>
                  <td
                    className="border px-[1.5mm] py-[2mm] text-center align-top text-[7.5pt] tabular-nums"
                    style={cell}
                  >
                    {i + 1}
                  </td>
                  <td
                    className="border px-[2mm] py-[2mm] align-top text-[7.5pt] [overflow-wrap:anywhere]"
                    style={cell}
                  >
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-neutral-900">{r.productName}</span>
                        {r.status === 'pending' && (
                          <span className="inline-block rounded bg-rose-100 px-1.5 py-0.5 text-[6pt] font-black uppercase text-rose-800 border border-rose-300 print:[print-color-adjust:exact]">
                            Pending
                          </span>
                        )}
                        {r.status === 'ready' &&
                          (sale.orderStatus === 'partially_ready' ||
                            (sale.items ?? []).some((it) => it.status === 'pending')) && (
                            <span className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[6pt] font-black uppercase text-emerald-800 border border-emerald-300 print:[print-color-adjust:exact]">
                              Ready
                            </span>
                          )}
                      </div>
                      {(r.code || r.info) && (
                        <span className="text-[6.5pt] text-neutral-500">
                          {[r.code && `Code: ${r.code}`, r.info].filter(Boolean).join(' · ')}
                        </span>
                      )}
                    </div>
                  </td>
                  <td
                    className="border px-[1.5mm] py-[2mm] text-center align-top text-[7.5pt] tabular-nums"
                    style={cell}
                  >
                    {fmt(r.rate)}
                  </td>
                  <td
                    className="border px-[1.5mm] py-[2mm] text-center align-top text-[7.5pt] tabular-nums"
                    style={cell}
                  >
                    {fmt(r.qty)} {r.unit ? r.unit.toLowerCase() : 'Pc'}
                  </td>
                  <td
                    className="border px-[1.5mm] py-[2mm] text-center align-top text-[7.5pt] tabular-nums"
                    style={cell}
                  >
                    {fmt(lineTotalWithoutVat)}
                  </td>
                  <td
                    className="border px-[1.5mm] py-[2mm] text-center align-top text-[7.5pt] tabular-nums"
                    style={cell}
                  >
                    {fmt(lineVat)}
                  </td>
                  <td
                    className="border px-[1.5mm] py-[2mm] text-center align-top text-[7.5pt] tabular-nums"
                    style={cell}
                  >
                    {fmt(lineTotalWithVat)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {/* what it comes to: what has been settled on the left, how the figure
          was arrived at on the right */}
      <div className="mt-[3mm] grid grid-cols-2 items-start gap-x-[8mm]">
        <table className="w-full border-collapse">
          <tbody>
            <TotalRow
              en="Paid Amount"
              ar="المبلغ المدفوع"
              value={`AED ${fmt(sale.advanceAmount || 0)}`}
            />
            {cashPaid > 0 && (
              <TotalRow en="Cash Amount" ar="مبلغ نقدي" value={`AED ${fmt(cashPaid)}`} />
            )}
            {cardPaid > 0 && (
              <TotalRow en="Card Amount" ar="مبلغ البطاقة" value={`AED ${fmt(cardPaid)}`} />
            )}
            {bankPaid > 0 && (
              <TotalRow
                en="Transfer Amount"
                ar="تحويل بنكي"
                value={`AED ${fmt(bankPaid)}`}
              />
            )}
            <TotalRow
              en="Due Amount"
              ar="المبلغ المستحق"
              value={`AED ${fmt(sale.balance || 0)}`}
              highlightRed
            />
            {sale.changeReturn && sale.changeReturn > 0 ? (
              <TotalRow
                en="Change Return"
                ar="الباقي المسترد"
                value={`AED ${fmt(sale.changeReturn)}`}
              />
            ) : null}
          </tbody>
        </table>

        <div>
          <table className="w-full border-collapse">
            <tbody>
              <TotalRow
                en="Total-Without Vat"
                ar="المجموع الفرعي"
                value={`AED ${fmt(sale.grossAmount || 0)}`}
              />
              {(sale.additionalCharges || 0) > 0 && (
                <TotalRow
                  en="Additional Charges"
                  ar="رسوم إضافية"
                  value={`AED ${fmt(sale.additionalCharges || 0)}`}
                />
              )}
              {(sale.discountAmt || 0) > 0 && (
                <TotalRow
                  en="Discount"
                  ar="الخصم"
                  value={`AED ${fmt(sale.discountAmt || 0)}`}
                />
              )}
              <TotalRow
                en="Total Before Tax"
                ar="المبلغ قبل الضريبة"
                value={`AED ${fmt(taxable)}`}
              />
              <TotalRow
                en={`VAT ${taxRate}%`}
                ar="ضريبة القيمة المضافة"
                value={`AED ${fmt(sale.taxAmt || 0)}`}
              />
            </tbody>
          </table>
          <div
            className="mt-[2mm] flex items-center justify-between gap-[3mm] px-[3mm] py-[2mm] text-white print:[print-color-adjust:exact]"
            style={{ backgroundColor: GREEN }}
          >
            <span className="text-[8pt] font-bold uppercase">Total Amount (inc VAT)</span>
            <span className="text-[9pt] font-black tabular-nums">
              AED {fmt(sale.netAmount || 0)}
            </span>
            <span className="text-[7pt]" dir="rtl">
              المبلغ الإجمالي (شامل الضريبة)
            </span>
          </div>
        </div>
      </div>

      {/* the figure spelled out */}
      <div className="mt-[3mm]">
        <p className="text-[7.5pt] font-bold uppercase">
          Amount in Words
          <span className="pl-2 font-normal text-neutral-600" dir="rtl">
            المبلغ كتابة
          </span>
        </p>
        <p className="text-[7.5pt] text-neutral-700">{amountInWords(sale.netAmount || 0)}</p>
      </div>

      {/* bank details */}
      {bankLines.length > 0 && (
        <div className="mt-[4mm] border-t border-neutral-300 pt-[2mm]">
          <p className="text-[7.5pt] font-bold uppercase">
            *Bank Details
            <span className="pl-2 font-normal text-neutral-600" dir="rtl">
              تفاصيل البنك
            </span>
          </p>
          <ul className="mt-[1mm] space-y-[0.5mm]">
            {bankLines.map((line, i) => (
              <li key={i} className="text-[7.5pt] text-neutral-700 [overflow-wrap:anywhere]">
                - {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
