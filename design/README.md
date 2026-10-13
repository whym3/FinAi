# Pravah Finance Control — design, round 1

Live canvas: https://claude.ai/artifact/TioE32uj9W317YGfGE2VcT (private until shared from its Share menu)

The canvas source is in `project/`: one `.dc.html` file per artboard, plus `canvas.json` for the layout.
`assets/pravah.css` is the shared stylesheet with tokens, both themes, components and icons. It is uploaded to the canvas as an asset, so after editing it, upload it again and update the `<link>` in every artboard.

## Frames

| Page | Frames |
|---|---|
| Desktop · Light (1440) | Overview (entity), Overview (firm), Intake inbox, Purchase-to-pay, Invoice review, Exceptions (table), Exceptions (board), GST hub |
| Desktop · Dark | The same eight frames |
| Components | Component set (light and dark), sidebar, top bar |
| Mobile (390) | Overview and Approve payment run, light and dark |

Each dark or alternate-view frame imports its light screen and passes `theme="dark"`, or `view="firm"` / `view="board"`. A change to a screen therefore shows up in all of its variants. The sidebar and top bar are separate components, and every screen imports them.

Interactive frames:
- Overview: the Entity / Firm toggle works.
- Invoice review: the decision options change the reason code, the debit-note block and the submit label.
- Exceptions: the Table / Board toggle works.
- Mobile approve: Approve switches to the released state.

## System

- **Type.** IBM Plex Sans and IBM Plex Sans Devanagari, with tabular lining figures everywhere. IBM Plex Mono is used for GSTIN, PAN, IRN and document numbers.
- **Colour.** Neutral slate surfaces with one ink-blue accent. The tokens (`--bg`, `--surface`, `--text`, `--accent`, `--ok`, `--warn`, `--bad`, `--none` and others) are the same in both themes and are redefined under `[data-theme="dark"]`.
- **Status.** One system everywhere, always shown as icon plus text:
  - green check: matched
  - amber clock: within tolerance or pending
  - red cross: mismatch or breach
  - grey dashed circle: missing
- **Data.** Each figure has a source chip (SAP · GST portal · Bank · Extracted) and a sync time. A stale source turns the chip and the top-bar pill amber, and adds a stale-data banner. Extracted fields show a 5-bar confidence meter. A low-confidence field that nobody has confirmed gets a dashed amber outline.
- **Numbers.** Amounts use Indian grouping, are right-aligned and always show paise (₹1,23,45,678.00). Negative amounts are red with a true minus sign. KPI cards use lakh and crore (₹36.5 L, ₹4.82 Cr), and the exact amount appears on hover.
- **Dates and periods.** Tables use 13-10-2026 and headers use 13 Oct 2026. Periods read FY 2026-27 and Q3 (Oct–Dec).
- **Charts.**
  - The cash forecast uses one ₹ axis: collections go up, payments go down and the closing balance is a line. There is no dual axis.
  - Blue and orange separate the series in both themes.
- **Hindi.** Labels wrap rather than truncate, and buttons and pills size to their content. The component page has a Hindi stress test with longer strings.

## Assumptions to confirm

- **TDS section.** The TDS card shows "Section 393(1) · purchase of goods" with "Legacy: 194Q" in small text. The exact table entry number under the Income-tax Act 2025 should be confirmed before build.
- **GSTR-2B timing.** GSTR-2B for Oct 2026 is generated on 14-11-2026. The GST hub therefore labels the October match as a draft built from IMS, with the recompute reminder.
- **SAP posted column.** In the three-way match this column shows the invoice parked in SAP (MIRO park 5105600231) at PO values, because the invoice is not posted yet.
- **Sample data.** All companies, people, GSTINs, PANs, bank details and amounts are invented. Vendors beyond the five in the brief were added to fill the top-10 tables.
