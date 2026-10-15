'use client';

import { fmt, fmtDate, orderNo } from '@/lib/format';
import { amountInWords } from '@/lib/words';
import { formatAddress, type AppSettings, type JobCard, type Ledger } from '@/lib/types';

/**
 * An order's invoice, laid out to be printed.
 *
 * Every label is given in English and Arabic because that is what a UAE
 * customer and a UAE auditor each expect to read, and the two sit on one line
 * so neither language looks like an afterthought: English reads in from the
 * left, Arabic in from the right, and the value sits between them.
 *
 * Sizes are in points rather than Tailwind's rem scale: this is the one view
 * in the app whose job is paper, and a point is the same length on paper
 * whatever the browser's font size happens to be.
 *
 * Nothing on the sheet is written into the code — the masthead, the two
 * marks, the title and the bank block all come from Settings, so the shop can
 * change its own letterhead without a release.
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
  /** A row that runs the width of the box rather than sharing it. */
  wide?: boolean;
}) {
  return (
    <tr>
      <td className="whitespace-nowrap py-[2px] pr-2 align-top text-[7pt] font-bold uppercase text-neutral-700">
        {en}:
      </td>
      <td
        className={`py-[2px] pr-2 align-top text-[7.5pt] font-semibold [overflow-wrap:anywhere] ${wide ? '' : 'w-full'
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
function TotalRow({ en, ar, value }: { en: string; ar: string; value: string }) {
  return (
    <tr>
      <td className="whitespace-nowrap py-[2px] pr-3 align-top text-[7pt] font-bold uppercase text-neutral-700">
        {en}:
      </td>
      <td className="w-full whitespace-nowrap py-[2px] pr-3 align-top text-[7.5pt] font-bold tabular-nums">
        {value}
      </td>
      <td className="whitespace-nowrap py-[2px] align-top text-[7pt] text-neutral-600" dir="rtl">
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

export function OrderInvoice({
  card,
  settings,
  customer,
}: {
  card: JobCard;
  settings: AppSettings;
  /** Supplies the address and email, which the order itself does not hold. */
  customer?: Ledger | null;
}) {
  const { company, bank } = settings;
  const rows = (card.items ?? []).filter((r) => (r.productName ?? '').trim() || r.amount > 0);
  const afterDiscount =
    Math.round((card.total + card.additionalCharges - card.discount) * 100) / 100;

  /** How this order was actually settled, rather than what was planned. */
  const paymentsList = card.payments ?? [];
  let cashPaid = paymentsList.filter((p) => p.mode === 'cash').reduce((s, p) => s + (p.amount || 0), 0);
  let cardPaid = paymentsList.filter((p) => p.mode === 'card').reduce((s, p) => s + (p.amount || 0), 0);
  let bankPaid = paymentsList.filter((p) => p.mode === 'bank').reduce((s, p) => s + (p.amount || 0), 0);
  if (!paymentsList.length && (card.advance || 0) > 0) {
    if (card.paymentMode === 'card') cardPaid = card.advance;
    else if (card.paymentMode === 'bank') bankPaid = card.advance;
    else cashPaid = card.advance;
  }

  const modes = Array.from(new Set(paymentsList.map((p) => p.mode)));
  const paymentMethod = modes.length
    ? modes.map((m) => (m === 'bank' ? 'Bank Transfer' : m === 'card' ? 'Card' : 'Cash')).join(' + ')
    : (card.advance || 0) > 0
      ? (card.paymentMode === 'card' ? 'Card' : card.paymentMode === 'bank' ? 'Bank Transfer' : 'Cash')
      : 'Unpaid';

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

      {/* what the sheet calls itself: static invoice title */}
      <p className="mt-[2mm] text-center text-[11pt] font-bold text-[#e03131] tracking-wider print:[print-color-adjust:exact]">
        ORDER INVOICE
      </p>
      <div
        className="mt-[1mm] h-[1.5px] w-full print:[print-color-adjust:exact]"
        style={{ backgroundColor: RULE }}
      />

      {/* who it is for, and which order it is */}
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
                    : card.partyName
                }
              />
              <DetailRow en="Phone" ar="رقم الهاتف" value={card.phone || customer?.phone} />
              <DetailRow en="Email" ar="البريد الإلكتروني" value={customer?.email} />
            </tbody>
          </table>
          <table className="w-full border-collapse">
            <tbody>
              <DetailRow en="Odr No" ar="رقم الطلب" value={orderNo(card)} />
              <DetailRow
                en="Booking No"
                ar="رقم الحجز"
                value={card.bookNo != null ? String(card.bookNo) : undefined}
              />
              <DetailRow en="Ref No" ar="رقم المرجع" value={card.ref} />
              <DetailRow en="Date" ar="تاريخ الفاتورة" value={fmtDate(card.date)} />
              <DetailRow en="Payment Method" ar="طريقة الدفع" value={paymentMethod} />
            </tbody>
          </table>
        </div>
        {/* The address and the collection date run the width of the box: one
            is too long to share a column, and the other is the thing the
            customer comes back for. */}
        <table className="w-full border-collapse">
          <tbody>
            <DetailRow en="Cus Add" ar="عنوان العميل" value={formatAddress(customer)} wide />
            <DetailRow
              en="Delivery Date"
              ar="تاريخ التسليم"
              value={fmtDate(card.deliveryDate)}
              wide
            />
          </tbody>
        </table>
      </div>

      {/* what was ordered */}
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
              <td colSpan={7} className="border px-[2mm] py-[6mm] text-center text-neutral-500" style={cell}>
                No items on this order.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => {
              const taxRate = settings.taxRate ?? 5;
              const lineTotalWithoutVat = Math.round(r.amount * 100) / 100;
              const lineVat = Math.round((lineTotalWithoutVat * (taxRate / 100)) * 100) / 100;
              const lineTotalWithVat = Math.round((lineTotalWithoutVat + lineVat) * 100) / 100;

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
                    {r.productName}
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
                    {fmt(r.qty)} Pc
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
        {card.status !== 'converted' ? (
          <table className="w-full border-collapse">
            <tbody>
              <TotalRow en="Paid Amount" ar="المبلغ المدفوع" value={`AED ${fmt(card.advance)}`} />
              {cashPaid > 0 && <TotalRow en="Cash Amount" ar="مبلغ نقدي" value={`AED ${fmt(cashPaid)}`} />}
              {cardPaid > 0 && <TotalRow en="Card Amount" ar="مبلغ البطاقة" value={`AED ${fmt(cardPaid)}`} />}
              {bankPaid > 0 && <TotalRow en="Bank Transfer" ar="تحويل بنكي" value={`AED ${fmt(bankPaid)}`} />}
              <TotalRow en="Due Amount" ar="المبلغ المستحق" value={`AED ${fmt(card.balance)}`} />
            </tbody>
          </table>
        ) : (
          <div />
        )}

        <div>
          <table className="w-full border-collapse">
            <tbody>
              <TotalRow en="Total-Without Vat" ar="المجموع الفرعي" value={`AED ${fmt(card.total)}`} />
              <TotalRow
                en="Additional Charges"
                ar="رسوم إضافية"
                value={`AED ${fmt(card.additionalCharges)}`}
              />
              <TotalRow en="Discount" ar="الخصم" value={`AED ${fmt(card.discount)}`} />
              <TotalRow
                en="Total Before Tax"
                ar="المبلغ قبل الضريبة"
                value={`AED ${fmt(afterDiscount)}`}
              />
              <TotalRow
                en={`VAT ${settings.taxRate}%`}
                ar="ضريبة القيمة المضافة"
                value={`AED ${fmt(card.tax)}`}
              />
            </tbody>
          </table>
          <div
            className="mt-[2mm] flex items-center justify-between gap-[3mm] px-[3mm] py-[2mm] text-white print:[print-color-adjust:exact]"
            style={{ backgroundColor: GREEN }}
          >
            <span className="text-[8pt] font-bold uppercase">Total Amount (inc VAT)</span>
            <span className="text-[9pt] font-black tabular-nums">AED {fmt(card.netAmount)}</span>
            <span className="text-[7pt]" dir="rtl">
              المبلغ الإجمالي (شامل الضريبة)
            </span>
          </div>
        </div>
      </div>

      {/* the figure spelled out, which is what settles an argument over it */}
      <div className="mt-[3mm]">
        <p className="text-[7.5pt] font-bold uppercase">
          Amount in Words
          <span className="pl-2 font-normal text-neutral-600" dir="rtl">
            المبلغ كتابة
          </span>
        </p>
        <p className="text-[7.5pt] text-neutral-700">{amountInWords(card.netAmount)}</p>
      </div>

      {/* how to pay the rest */}
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
