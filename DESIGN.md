---
name: QR Sal
description: A compact local QR scanner with readable results.
colors:
  paper: '#f6f8fc'
  white: '#fff'
  ink: '#172235'
  muted: '#57677c'
  line: '#dce3ee'
  blue: '#2458dc'
  blue-wash: '#edf2ff'
  blue-hover: '#1749c6'
  green: '#146548'
  red: '#a52235'
  code-surface: '#edf1f8'
  code-line: '#d8e0ed'
  code-key: '#6543a1'
  code-string: '#0f644b'
typography:
  display:
    fontFamily: 'Manrope, sans-serif'
    fontSize: 'clamp(32px, 4vw, 48px)'
    fontWeight: 750
    lineHeight: 1.15
    letterSpacing: '-1.4px'
  headline:
    fontFamily: 'Manrope, sans-serif'
    fontSize: '26px'
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: '-0.7px'
  panel-title:
    fontFamily: 'Manrope, sans-serif'
    fontSize: '13px'
    fontWeight: 750
    lineHeight: 1.6
  body:
    fontFamily: 'Manrope, sans-serif'
    fontSize: '14px'
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: 'Manrope, sans-serif'
    fontSize: '12px'
    fontWeight: 700
    lineHeight: 1.2
  text-action:
    fontFamily: 'Manrope, sans-serif'
    fontSize: '12px'
    fontWeight: 650
    lineHeight: 1.6
  code:
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.7
  code-example:
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.75
rounded:
  compact: '6px'
  control: '8px'
  inset: '12px'
  panel: '14px'
spacing:
  inline: '8px'
  control: '12px'
  inset: '16px'
  panel: '20px'
  group: '24px'
  page: '42px'
components:
  button-primary:
    backgroundColor: '{colors.blue}'
    textColor: '{colors.white}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '12px 16px'
  button-primary-hover:
    backgroundColor: '{colors.blue-hover}'
  button-secondary:
    backgroundColor: '{colors.white}'
    textColor: '{colors.ink}'
    typography: '{typography.label}'
    rounded: '{rounded.control}'
    padding: '12px 16px'
  button-secondary-hover:
    backgroundColor: '{colors.paper}'
  button-text:
    backgroundColor: 'transparent'
    textColor: '{colors.muted}'
    typography: '{typography.text-action}'
    rounded: '{rounded.control}'
    padding: '8px'
  button-text-hover:
    textColor: '{colors.blue}'
  button-page:
    backgroundColor: '{colors.white}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '5px'
  select:
    backgroundColor: '{colors.white}'
    textColor: '{colors.ink}'
    rounded: '{rounded.compact}'
    padding: '8px'
  result-count:
    backgroundColor: '{colors.paper}'
    textColor: '{colors.ink}'
    rounded: '{rounded.compact}'
    height: '24px'
  scanner-panel:
    backgroundColor: '{colors.white}'
    textColor: '{colors.ink}'
    rounded: '{rounded.panel}'
  result-item:
    backgroundColor: '{colors.white}'
    textColor: '{colors.ink}'
    padding: '18px 20px'
  status-busy:
    backgroundColor: '{colors.blue-wash}'
    textColor: '{colors.blue}'
    padding: '14px 20px'
  status-success:
    textColor: '{colors.green}'
  status-error:
    textColor: '{colors.red}'
  code-container:
    backgroundColor: '{colors.code-surface}'
    rounded: '{rounded.inset}'
---

# Design System: QR Sal

## Overview

**Creative North Star: "A working scanner beside readable results"**

QR Sal uses a cool canvas, white divided panels, ink text and blue actions. Compact Manrope typography keeps attention on the selected image and its decoded content. The QR finder mark identifies the product; Sal identifies the creator.

This document records the implemented interface in [the stylesheet](demo/style.css), [scanner page](demo/index.html), [interaction code](demo/app.mjs) and [privacy page](demo/privacy.html). Product requirements remain in [PRODUCT.md](PRODUCT.md).

**Key Characteristics:**

- A visible source and readable results share one workspace.
- Flat surfaces, restrained borders and compact controls.
- Short labels, selectable output and explicit status text.
- Shared typography and colors across scanner and privacy pages.

## Colors

The palette combines cool neutrals with a clear action blue and dedicated feedback colors. Values in the frontmatter match the source.

- **Primary:** `blue` marks primary actions, links, keyboard focus and detected QR outlines. `blue-wash` marks active scanning and drag-over; `blue-hover` deepens primary buttons on hover.
- **Neutral:** `paper` is the page canvas and count background; `white` is the scanner and control surface; `ink` is the main text; `muted` supports hints and metadata; `line` divides panels and borders controls.
- **Feedback:** `green` accompanies successful decoding; `red` accompanies errors or an unsuccessful decode. Each status also has a written message.
- **Code:** `code-surface` and `code-line` separate the integration example. `code-key`, `code-string` and the primary blue distinguish its syntax.

## Typography

Manrope is self-hosted with a sans-serif fallback and variable weights. The system monospace stack separates decoded payloads and integration code from interface text.

- **Display:** the scanner headline uses the display role; on narrow screens it becomes (36px) with tighter spacing (-1px).
- **Headline:** the integration heading uses the headline role, becoming (25px) on narrow screens.
- **Panel title and labels:** short, strongly weighted titles anchor source, output and actions. Supporting text is usually (12px); metadata uses tabular numerals.
- **Body:** the default body role supports the privacy page, whose paragraphs are capped at (70ch). Privacy headings use (38px) and (20px).
- **Code:** decoded text wraps long content and remains selectable; the integration example uses the slightly roomier code-example role and horizontal overflow when needed.

## Layout

Header, main and footer share a centered maximum width (1280px) and desktop side padding (42px). The scanner is a divided grid: source `minmax(0, 1.85fr)`, results `minmax(300px, 1fr)`. Toolbars, status, content and bottom actions stay visibly separated. The source area has a minimum height (390px); result lists scroll within a maximum height (540px).

At (900px) and below, side padding becomes (25px), the introduction stacks, the scanner ratio becomes `1.4fr` to `1fr` with a (280px) result minimum, and scan controls wrap. At (650px) and below, the scanner stacks source above results, replacing the vertical divider with a horizontal one. Main side padding becomes (16px), the source minimum becomes (360px), and results range from (170px) to (500px) high. The navigation links and file controls remain available.

The integration section uses two equal columns with a (70px) gap, reducing to (35px) at the intermediate breakpoint and one column with a (26px) gap on mobile. The privacy page is a single reading column capped at (820px). Small control gaps and repeated panel insets form the spacing rhythm; larger gaps separate scanner, integration content and footer.

## Elevation & Depth

The interface has no box shadows. White surfaces, cool background tones and thin dividers establish depth. The synthetic sample sits in a lightly bordered frame with a fixed tilt (-5deg).

New result rows reveal through clipping and opacity over (250ms), using `cubic-bezier(0.16, 1, 0.3, 1)`. Button background and text changes take (160ms). Reduced-motion preferences remove animations, transitions and smooth scrolling.

## Shapes

The scanner uses the panel radius; buttons and the repository link use the control radius; the sample and code example use the inset radius. Selects and the count badge use the compact radius. Dividers and control outlines are thin (1px). The [brand mark](demo/assets/icon.svg) combines a rounded blue tile with square QR finder shapes. Interface icons use rounded strokes, normally in a (20px) box.

## Components

- **Buttons:** primary actions are filled blue; secondary actions have a white surface and neutral border; text actions use muted text without a visible border. Standard file buttons have a minimum height (42px). Small scan actions use (9px 13px) padding and a (37px) minimum height; mobile horizontal padding reduces by (2px). Disabled buttons use half opacity and a default cursor. Page arrows have a minimum target of (34px) square.
- **Focus:** buttons, links, inputs, selects and disclosure summaries share a blue outline (3px) offset by (4px). The skip link becomes visible on focus.
- **Source:** the empty state shows a labeled synthetic QR sample, file chooser and sample action. Drag-over adds a dashed blue inset outline and blue wash. A loaded image replaces the empty state; decoded corner outlines are drawn on its preview. File names truncate within the toolbar.
- **Results:** divided rows contain an ordinal, optional PDF page number, Copy action, wrapped monospace payload and decoder metadata. Copy text is unavailable until a code exists; Export JSON becomes available after a page result exists. Copy confirmation briefly changes the button label for (1800ms).
- **Status:** a polite live region reports ready, opening/scanning, success, unsuccessful decode and errors. Busy uses blue wash; success uses green text; errors use red text. Cancellation restores controls and can retain completed page results. Clear restores the initial state. During scanning, file-selection and page-navigation controls are disabled and Cancel is shown.
- **Settings:** a native disclosure reveals a labeled select and native checkboxes. The select has a neutral border; checked controls use blue. Settings are applied with Scan again. There is no separate inline field-error style.
- **Navigation:** the compact brand and two visible navigation links remain in the header on mobile. Text links turn blue on hover; the repository link has a white bordered enclosure. Footer links underline on hover.
- **Code example:** a tonal container separates its label from an actual integration snippet. It uses the code-example type role, syntax colors and scrollable overflow.

## Do's and Don'ts

### Do:

- **Do** reuse the recorded type, colors, radii and focus treatment across the existing surfaces.
- **Do** keep file controls and readable results available when the scanner stacks on mobile.
- **Do** pair feedback colors with explicit text and honor reduced-motion preferences.
- **Do** preserve selectable, wrapping decoded text and labeled synthetic examples.

### Don't:

- **Don't** turn decoded payloads into executable markup or automatically opened links.
- **Don't** present a successful decode as proof of sender identity, link safety or universal recovery.
- **Don't** replace native labels, keyboard focus or cancellation feedback with decoration.
