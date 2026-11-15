[English](01-charting-core.en.md) · [فارسی](01-charting-core.md)

# 01 — Charting Core in TradingView

> Goal: document the **behavior** of the features so they can be rebuilt clean-room. No code or long text from TradingView has been copied; everything has been rewritten.
> Reference version: web/desktop Supercharts, 2025–2026. Research date: 2026-10-13.
>
> Column guide:
> - **Complexity**: S = small (a few days), M = medium (1–3 weeks), L = large (needs separate data/engine or months of work)
> - **Priority**: Core = the product makes no sense without it / High / Medium / Low
> - The ⚠️ mark = not confirmed by an official source (based on general knowledge/secondary sources)

---

## 1. Chart types

TradingView puts them in two categories: **Time-based** (each candle = one time period) and **Price-based** (a new candle forms only when price moves by a set amount; non-linear time axis).

### 1.1 Time-based charts

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Bars | OHLC bar; left tick = Open, right tick = Close; colored by up/down (optional: color by previous candle) | S | Core |
| Candles | Japanese candlestick; separate settings for Body / Border / Wick and up/down colors | S | Core |
| Hollow candles | Candles where close>open are hollow; color is based on comparison with the previous close | S | High |
| Volume candles | Each candle's width is proportional to its volume relative to the other visible candles | M | Medium |
| Line | Line connecting the closes (selectable source: close/open/high/low/hl2/…) | S | Core |
| Line with markers | Like Line but with a circle on each data point | S | Medium |
| Step line | Stepped line (horizontal then vertical) instead of diagonal | S | Medium |
| Area | Line with a gradient fill beneath it | S | High |
| HLC area | Area between High and Low with the Close line in the middle (two colors above/below the close) | M | Low |
| Baseline | Two colors relative to a base level (Base level as a percentage of height or a value); fill above/below | M | High |
| Columns | Vertical columns from zero to the value (suited to economic data; green/red relative to the previous one) | S | Medium |
| High-low | Only the High–Low range bar with an optional top/bottom label | S | Low |
| Heikin Ashi | Smoothed candles built from the average OHLC of the previous candle; actual prices optional in the status line | S | High |
| Volume footprint | Inside each candle, buy volume (right) and sell volume (left) at each price level; Delta and Total below the candle; Imbalance/POC/Value area row; needs tick data (Premium+ plan) | L | Medium |
| TPO (Time Price Opportunity / Market Profile) | Lettered profile (each letter = one time block, e.g. 30 minutes) for a daily/weekly/monthly period; POC, Value Area, Initial Balance, Single prints | L | Medium |
| Session volume profile (SVP) | Volume-at-price histogram for each session/sub-session drawn on the chart itself (as a chart type) | L | Medium |

### 1.2 Price-based charts (non-linear time axis)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Renko | A new brick forms when price moves by the Box size; Box size: Traditional or ATR; source Close or OHLC; Reversal amount; optional Wicks | M | Medium |
| Line break | A new line/block only when the close breaks beyond the range of the previous N lines (default 3) | M | Low |
| Kagi | Vertical line that changes direction when price moves by the Reversal amount (percent/ATR/fixed); Yang/Yin thickness | M | Low |
| Point & Figure | Columns of X (up) and O (down); Box size and Reversal amount; source Close or High/Low | M | Low |
| Range | A new candle forms when the price range reaches a set Range; Phantom bars option | M | Medium |

**Shared behavioral notes:** the chart type is switched from the top toolbar button or Alt+ shortcuts; price-based chart types are not supported in Bar Replay; each chart type has its own Symbol tab in Settings; a chart type can be marked as a "Favorite" for quick access in the toolbar.

---

## 2. Drawing tools — left toolbar grouping

TradingView places the tools in **7 groups** (including Cursors) on the left toolbar. Each group button shows the last-used tool, and the arrow next to it opens the full submenu; every tool has a star (Favorite).

### 2.1 Cursors

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Cross | Crosshair cursor with a full crosshair | S | Core |
| Dot | Dot cursor (minimal crosshair) | S | Medium |
| Arrow | Regular arrow cursor, no crosshair | S | Medium |
| Demonstration | Demonstration cursor (highlighted circle for video recording/presentations) | S | Low |
| Magic | ⚠️ A cursor that suggests a related label/tool automatically when you click a candle (new) | M | Low |
| Eraser | Click any drawing = delete; with Ctrl, erase part of a Brush | S | High |

### 2.2 Trend line tools (Lines + Channels + Pitchforks)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Trend line | Two-point segment; optional extend left/right, show price range/bars/angle/% | S | Core |
| Ray | Line from the first point, infinite in the direction of the second point | S | Core |
| Info line | Trend line with an info box (price change, %, bar count, time, angle) | S | High |
| Extended line | Line infinite in both directions | S | High |
| Trend angle | Trend line showing the angle and an arc | S | Medium |
| Horizontal line | Full-width horizontal line with a price label on the axis | S | Core |
| Horizontal ray | Horizontal line from a point to the right | S | Core |
| Vertical line | Vertical line at a single time, with a time label | S | Core |
| Cross line | Horizontal + vertical line combined at one point | S | Medium |
| Parallel channel | Three-point channel with a middle line and fill | S | High |
| Regression trend | Linear regression channel between two times with upper/lower standard deviation and Pearson's R | M | Medium |
| Flat top/bottom | Channel with one perfectly horizontal side | S | Low |
| Disjoint channel | Two non-parallel lines (diverging/converging channel) | S | Low |
| Pitchfork (Andrews) | Three-point pitchfork with a median line and adjustable parallel levels | M | Medium |
| Schiff pitchfork | Pitchfork with the starting point moved to half the height | M | Low |
| Modified Schiff pitchfork | Modified version with the starting point shifted in both time and price | M | Low |
| Inside pitchfork | Pitchfork with an inner median line | M | Low |

### 2.3 Gann & Fibonacci

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Fib retracement | Retracement levels (0, .236, .382, .5, .618, .786, 1 + extensions) between two points; editable levels/colors; log scale; reverse | M | Core |
| Trend-based fib extension | Three-point; extension of the first wave from the third point | M | High |
| Fib channel | Parallel channel with Fibonacci levels | M | Medium |
| Fib time zone | Vertical lines at Fibonacci time intervals | S | Medium |
| Fib speed resistance fan | Speed fan with a Fibonacci grid in price and time | M | Low |
| Trend-based fib time | Fibonacci times based on three points | M | Low |
| Fib circles | Concentric circles with Fibonacci radii | M | Low |
| Fib spiral | Golden spiral | M | Low |
| Fib speed resistance arcs | Fibonacci arcs from a single point | M | Low |
| Fib wedge | Wedge with Fibonacci arcs | M | Low |
| Pitchfan | Fan of lines from the pitchfork point | M | Low |
| Gann box | Rectangle with Gann time/price divisions (adjustable levels, Shift = fixed steps) | M | Medium |
| Gann square fixed | Gann square with a fixed ratio | M | Low |
| Gann square | Free-form Gann square with fans and arcs | M | Low |
| Gann fan | Fan of Gann angles (1x1, 1x2, 2x1, …) | M | Medium |

### 2.4 Patterns (+ Elliott + Cycles)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| XABCD pattern | Five-point harmonic pattern showing the Fibonacci ratios of each leg | M | Medium |
| Cypher pattern | Cypher harmonic pattern with ratios | M | Low |
| Head and shoulders | 7 points with a neckline | M | Medium |
| ABCD pattern | Four points with ratios | S | Medium |
| Triangle pattern | Four triangle points with fill | S | Low |
| Three drives pattern | Three-drives pattern (7 points) | M | Low |
| Elliott impulse wave (12345) | Five impulse waves with a selectable wave Degree label | M | Medium |
| Elliott correction wave (ABC) | Three-part corrective wave | S | Medium |
| Elliott triangle wave (ABCDE) | Elliott triangle | S | Low |
| Elliott double combo (WXY) | Double combination | S | Low |
| Elliott triple combo (WXYXZ) | Triple combination | S | Low |
| Cyclic lines | Repeating, equally spaced vertical lines | S | Low |
| Time cycles | Repeating semicircles along the time axis | S | Low |
| Sine line | Sine wave with period/amplitude set by two points | S | Low |

### 2.5 Forecasting & measurement (+ Volume-based)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Long position | Profit/loss box with Entry/TP/SL; calculates R:R and position size from Account size and Risk %; shows the status when price reaches TP/SL | M | Core |
| Short position | Same for selling | M | Core |
| Position forecast / Forecast | Price forecast from a source point to a target; once the time arrives, shows the result (Success/Failure) | M | Medium |
| Bars pattern | Copy the candles of a range and paste them as a pattern (modes: HL bars, Line close/open/high/low, Mirror/Flip) | M | Low |
| Ghost feed | Draw hypothetical future candles with successive clicks | M | Low |
| Projection | Three-point projection (extension arcs) | M | Low |
| Sector | ⚠️ Three-point sector/angle tool (new in the official list) | S | Low |
| Anchored VWAP | VWAP from a chosen anchor point to now with standard deviation bands | M | High |
| Fixed range volume profile | Volume profile between two times: POC, Value Area (70%), Up/Down volume, row count | L | High |
| Anchored volume profile | Volume profile from an anchor to the latest candle (grows with new data) | L | Medium |
| Price range | Measure the price distance (absolute, %, ticks) | S | High |
| Date range | Measure candle count, duration, volume | S | High |
| Date and price range | Both combined in one box | S | High |

### 2.6 Geometric shapes + Brushes + Arrows

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Brush | Freehand drawing; smoothing, start/end arrows, fill for closed shapes | M | Medium |
| Highlighter | Thick semi-transparent pen for highlighting | S | Low |
| Arrow | Segment with an arrowhead | S | High |
| Arrow marker | Large solid arrow with text | S | Medium |
| Arrow mark up / down / left / right | Small arrow mark anchored to a point | S | Medium |
| Rectangle | Rectangle with fill, inner text, extend left/right, middle line | S | Core |
| Rotated rectangle | Three-point rotatable rectangle | S | Low |
| Path | Open polyline with an end arrow | S | Low |
| Circle | Circle (center + radius) | S | Medium |
| Ellipse | Ellipse | S | Medium |
| Polyline | Closed polygon with fill | S | Low |
| Triangle | Three-point triangle | S | Low |
| Arc | Three-point arc | S | Low |
| Curve | Single Bézier curve | S | Low |
| Double curve | S-shaped curve | S | Low |

### 2.7 Annotation tools (Text, Notes, Content)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Text | Free text on the chart (font, size, bold/italic, background, border, wrap) | S | Core |
| Anchored text | Text anchored to a screen position (not time/price) | S | Medium |
| Note / Anchored note | Small pin that shows the full note text on hover | S | Medium |
| Price note | Price label + a note attached to a level | S | Medium |
| Pin | Pin with a note | S | Low |
| Table | Editable table (rows/columns) on the chart | M | Low |
| Callout | Text bubble with a pointer to a point | S | Medium |
| Comment | Chat bubble | S | Low |
| Price label | Price label on a candle | S | Medium |
| Signpost | Vertical sign with text/emoji on a candle | S | Low |
| Flag mark | Flag on a candle | S | Low |
| Image | Upload and place an image on the chart | M | Low |
| X posts / Ideas | Embed an X post or a TradingView idea on the chart | M | Low |
| Icons / Emojis / Stickers | Icon library (FontAwesome-like), emojis (Twemoji) and graphic stickers, resizable/recolorable/rotatable | M | Low |

### 2.8 Left-toolbar utilities (Toolbar utilities)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Measure | Quick measurement tool (also Shift+Click anywhere on the chart) | S | Core |
| Zoom in / Zoom out | Drag a rectangle to zoom into an area; a zoom-back button | S | High |
| Weak magnet | Drawing points snap to OHLC when they are close to it | S | High |
| Strong magnet | Always snaps to the nearest OHLC; Ctrl temporarily inverts the magnet | S | High |
| Snap to indicators | ⚠️ Points snap to indicator values | M | Low |
| Stay in drawing mode (Keep drawing) | The tool stays active after a drawing is finished | S | High |
| Lock all drawings | Lock all drawings (cannot be moved) | S | High |
| Hide all | Menu: hide Drawings / Indicators / Positions & orders / All (Ctrl+Alt+H) | S | High |
| Remove | Menu: remove drawings, indicators, or both (with confirmation) | S | High |
| Sync drawings | Menu: sync drawings: this chart only / in layout / global | M | High |
| Object tree | (In the right panel) tree of all objects; grouping, Z-order changes, lock/hide, rename | M | High |
| Favorites toolbar | Separate floating bar of starred tools; movable; editable order | S | Medium |
| Drawing templates | Save a tool's style as a template (Save as / Apply / Apply default) | S | High |
| Hide/show left toolbar | Collapse the toolbar | S | Medium |

---

## 3. Drawing properties & behaviors

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Floating drawing toolbar | When a drawing is selected, a floating bar: template, line color, fill color, thickness, line style, settings, lock, delete, … | M | Core |
| Settings › Style tab | Line color/thickness/style (solid/dashed/dotted), line ends (arrow/normal), extend, fill, levels (for Fib/Gann), show price/stats | M | Core |
| Settings › Text tab | Text attached to the drawing, font, color, horizontal/vertical alignment, orientation | S | High |
| Settings › Coordinates tab | Numeric editing of the Price and Bar/Time of each anchor point | S | High |
| Settings › Visibility tab | Show the drawing only on selected intervals (Ticks, Seconds, Minutes, Hours, Days, Weeks, Months, Ranges with a min–max range) | M | High |
| Quick interval visibility | Right-click menu: "Current interval only", "Current and higher", "Current and lower", "All" | S | Medium |
| Multi-select | Ctrl+Click or selection in the Object tree; bulk editing of style/visibility | M | High |
| Clone | Ctrl+Drag or the Clone menu; Copy/Paste with Ctrl+C/V (even across charts) | S | High |
| Move constraints | Shift+Drag = move horizontally/vertically only; arrow keys = fine movement; Shift while drawing = 45°/horizontal angle, square, circle | S | Medium |
| Lock / Hide per object | Lock and hide a single object | S | High |
| Z-order | Bring to front / Send to back / Bring forward / Send backward | S | Medium |
| Move to pane / scale | Move a drawing to another pane or pin it to another scale (left/right/no scale) | M | Low |
| Groups (Object tree) | Group objects under a name; group operations | M | Medium |
| Drawing sync | Drawings sync between charts with the same symbol (in layout or Global — across all layouts) | L | High |
| Drawings bound to symbol | Drawings belong to a symbol; switching symbols hides them and switching back shows them | M | Core |
| Alerts on drawings | ⚠️ Create an alert on a trend line/channel/horizontal line from the drawing menu (details in the Alerts document) | M | High |
| Undo/Redo for drawings | Every create/edit/delete goes into the Undo history | M | Core |

---

## 4. Chart settings window (all tabs)

Access: the gear icon, right-click › Settings, or double-click on the series. At the bottom of the window: **Template** (Save/Apply/Apply defaults), Cancel, Ok.

### 4.1 Symbol

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Style per chart type | Up/down colors, body/border/wick, line thickness/style, price source (for Line/Area/…) | M | Core |
| Color bars based on previous close | Color based on the previous close instead of the open | S | Medium |
| Session | Regular trading hours / Extended trading hours (for stocks) | M | High |
| Contract change adjustment | Back-adjustment for continuous futures | M | Low |
| Settlement as close | Use the settlement price for the futures daily candle | S | Low |
| Dividends adjustment | Adjust data for dividends | M | Low |
| Precision | Number of decimals for price display (Default, 1/10 … or fractional such as 1/32) | S | High |
| Timezone | Chart timezone or "Exchange" | M | Core |

### 4.2 Status line

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Logo | Show the symbol logo | S | Low |
| Title | Description / Ticker / Ticker and description | S | High |
| Chart values (OHLC) | Show O H L C under the cursor | S | Core |
| Bar change values | Absolute and percentage change of the candle | S | High |
| Volume | Volume in the status line | S | High |
| Last day change | ⚠️ Last-day change | S | Low |
| Indicator titles / arguments / values | Show indicator names, inputs and values | S | High |
| Market status / Open market status | Whether the market is open or closed | S | Medium |
| Background | Semi-transparent background behind the status line | S | Low |

### 4.3 Scales and lines

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Currency and Unit labels | Show currency/unit on the price scale (and currency conversion) | M | Medium |
| Scale modes | Regular / Percent / Indexed to 100 / Logarithmic (and Auto) | M | Core |
| Lock price to bar ratio | Keep the price-to-bar-count ratio fixed while zooming | M | Medium |
| Scales placement | Auto / Left / Right for the scales | M | Medium |
| No overlapping labels | Prevent labels on the axis from overlapping | M | Medium |
| Plus button | A + button on the price scale for quickly creating an alert/order | S | Medium |
| Countdown to bar close | Countdown to the candle close under the price label | S | High |
| Symbol last price label/line | Last-price label and line (value/line, color) | S | Core |
| Previous day close label/line | Previous day's close line | S | Medium |
| Pre/Post market price label | Pre/post-market price | S | Low |
| High and low price label/line | Line/label for the highest and lowest price of the visible area | S | Medium |
| Average close price line | ⚠️ Line of the average close of the visible range | S | Low |
| Bid and ask labels/lines | Show bid/ask | S | Medium |
| Indicators & financials name/value labels | Indicator name/value labels on the scale | S | High |
| Time scale: Day of week on labels | Show the day of the week | S | Low |
| Date format / Time hours format | Date format and 12/24-hour format | S | Medium |
| Save chart left edge position when changing interval | Lock the left edge when switching intervals | S | Low |

### 4.4 Canvas

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Background | Solid color or gradient | S | High |
| Grid lines | Vertical / Horizontal / Both / None with color and opacity | S | Core |
| Pane separators | Color of the pane separators | S | Low |
| Crosshair | Color, thickness, line style | S | High |
| Watermark | Show the symbol/interval large in the background | S | Low |
| Scales text/lines | Font size, text color, axis line color | S | Medium |
| Navigation buttons | Visibility of the zoom/scroll/reset buttons (Always / on hover / hidden) | S | Medium |
| Pane buttons | Visibility of the pane buttons (move up/down, collapse, maximize, remove) | S | Medium |
| Margins | Series distance from top/bottom (%) and right distance (number of candles) | S | Medium |

### 4.5 Trading

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Buy/Sell buttons | Quick buy/sell buttons on the chart | M | Medium |
| Instant order placement | Send orders without a confirmation window | S | Medium |
| Execution sound / Notifications | Execution sound; notification for rejections only or for all events | S | Low |
| Positions P&L display | Show profit/loss in money/ticks/percent | S | Medium |
| Reverse button | Button to reverse a position, shown on hover | S | Low |
| Orders / Brackets P&L | Show open orders and the profit/loss of TP/SL | M | Medium |
| Executions arrows | Trade execution arrows on candles | S | Medium |
| Extended price lines | Extend the order/position line across the full width | S | Low |
| Label alignment | Alignment of order labels: left/center/right | S | Low |
| Show on screenshots | Include orders/positions in screenshots | S | Low |

### 4.6 Alerts

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Alert lines | Show alert lines on the chart + color | S | High |
| Only active alerts | Show only active alerts | S | Medium |
| Alert volume | Alert loudness | S | Low |
| Auto-hide toasts | Pop-up hides automatically after 20 seconds | S | Low |

### 4.7 Events

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Ideas | Show community ideas on the chart (colored by direction) | M | Low |
| Dividends / Splits | Dividend and stock-split event icons on the time axis | M | Medium |
| Earnings | Earnings report date, estimated and actual EPS/Revenue, Earnings break lines | M | Medium |
| Economic events | ⚠️ Economic calendar events on the time axis | M | Medium |
| Latest news / news notifications | Latest-news marker and news notification | M | Low |

---

## 5. Layouts and top-level chart features

### 5.1 Multi-chart layouts

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Multi-chart grid | Up to 16 charts in one layout (plan limit: 1/2/4/8/10/16); dozens of arrangements (rows, columns, 2x2 grid, 3x3, 1+3, …) | L | High |
| Resizable splitters | Resize charts by dragging the border | M | High |
| Active chart / maximize | Active chart with a blue frame; Alt+Enter = make one chart full-screen; Tab to move between charts | S | High |
| Sync: Symbol | Switch the symbol in all charts | S | High |
| Sync: Interval | Switch the interval in all charts | S | High |
| Sync: Crosshair | Show the crosshair simultaneously in all charts | M | High |
| Sync: Time | Scroll to a shared time in all charts (synced go-to-date) | M | Medium |
| Sync: Date range | Sync the date range (Range selector) | M | Medium |
| Sync groups (linking) | Color groups for partial symbol sync between charts and widgets | M | Medium |
| Multiple tabs / windows | ⚠️ Layouts in different tabs/desktop windows; desktop multi-monitor | M | Low |

### 5.2 Layout saving, templates, sharing

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Save / autosave layout | Save the full state (symbols, interval, indicators, drawings, settings) in the cloud; optional autosave | M | Core |
| Layout manager | Save as / Rename / Make a copy / Load (.); list of layouts with search and stars | M | High |
| Share layout | Public read-only link to a layout (Sharing on/off) | M | Medium |
| Chart templates | Save indicators + style (optionally with symbol/interval) and apply to any chart | M | High |
| Indicator templates | Save a set of indicators | S | High |
| Default settings templates | Template at the bottom of every Settings window (Save as default) | S | Medium |
| Export chart data | ⚠️ Download chart data as CSV (OHLC + indicators) — paid plan | S | Medium |
| Import/export settings | ⚠️ Not available (cloud-based) | — | Low |

### 5.3 Compare / Overlay / Symbol math

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Compare symbol | Add another symbol on the chart; scale switches to Percent automatically | M | High |
| Overlay on new price scale / same scale | Place the symbol on a new scale, the same scale, or a new pane | M | Medium |
| Spread / Symbol math | Expressions in search such as `BTCUSDT/ETHUSDT`, `ES1!-NQ1!`, `2*AAPL+MSFT`; operators + − * / and constants, powers; synthetic chart | L | Medium |
| Price scale per series | For each series/indicator: Pin to right/left scale, New scale, No scale (overlay) | M | High |

### 5.4 Price scale modes & actions

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Auto (fits data to screen) | Automatic vertical fit based on visible data; dragging the scale = auto turns off; the A button | M | Core |
| Logarithmic (Alt+L) | Logarithmic scale | M | Core |
| Percent (Alt+P) | Show percent change relative to the first visible candle | M | High |
| Indexed to 100 | Normalize to 100 from the first visible candle | M | Medium |
| Invert scale (Alt+I) | Invert the price axis | S | Medium |
| Lock price to bar ratio | Keep the ratio fixed | M | Low |
| Scale price chart only | Auto-scale based on the main series only (indicators ignored) | S | Medium |
| Scale placement / Merge scales | Move the scale left/right; Merge all scales into one | M | Medium |
| Drag to zoom price / time | Dragging on the price axis = compress/stretch; on the time axis = horizontal zoom; double-click = reset | M | Core |
| Reset chart (Alt+R) | Restore zoom and scale to default | S | Core |

### 5.5 Sessions & timezone

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Extended hours (ETH) | Show pre/post market; different background for out-of-session periods | M | High |
| Session breaks | Vertical lines separating sessions | S | Medium |
| Timezone selector | Choose a timezone (UTC, Exchange, various cities) from the bottom of the chart | M | Core |
| Bottom toolbar | Date range presets (1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, All), Go to date, clock + timezone, %/log/auto buttons | M | High |

### 5.6 Bar Replay

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Select bar | Blue vertical line with scissors; click = starting point (later candles hidden) | M | High |
| Select date | Choose a start date from the calendar | S | High |
| First available date | Jump to the first available candle | S | Medium |
| Random bar | Start from a random candle (for unbiased practice) | S | Medium |
| Play / Pause (Shift+↓) | Automatic playback | M | High |
| Forward (Shift+→) | One step forward | S | High |
| Speed | Playback speed (roughly 10 seconds down to 0.1 seconds per candle — ⚠️ exact values not confirmed) | S | High |
| Update interval (replay interval) | Playback at an interval lower than the chart interval (e.g. a 1-hour candle built from 1-minute data) | L | Medium |
| Jump to real-time | Exit replay and return to live | S | High |
| Replay for all charts | Mode for this chart only or all charts in the layout, synced in time | L | Medium |
| Session save/resume | Automatically save the replay state and continue from the same point | M | Medium |
| Replay trading | ⚠️ Simulated trading on replay data (buy/sell panel, P&L) — according to current documentation, orders are executed on real-time data; needs further investigation | L | Medium |
| Indicators in replay | Indicators are computed with the replay data; Regression trend and FRVP are disabled | M | High |
| Limitations | Not supported: Renko, Kagi, PnF, Range, Line break, Footprint, TPO, spread and tick charts | — | — |

### 5.7 Intervals

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Standard intervals | 1m, 3m, 5m, 15m, 30m, 45m, 1h, 2h, 3h, 4h, 1D, 1W, 1M, 3M, 6M, 12M | M | Core |
| Seconds | 1s, 5s, 10s, 15s, 30s (paid plan) | M | Medium |
| Ticks | 1T, 10T, 100T, 1000T (Expert+ plan; only if data is available) | L | Low |
| Ranges | 1R, 10R, 100R, 1000R (range candles) | M | Low |
| Custom interval | Add a custom interval: number + unit (minutes/hours/days/weeks/months/ranges/seconds) | S | High |
| Favorite intervals | Star intervals to show them in the top toolbar | S | High |
| Type-to-change interval | Type a number (e.g. 15, 4h, 1D) or "," on the chart = interval-change dialog | S | High |

### 5.8 Symbol search

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Symbol search dialog | Search by ticker/name with a type filter (All, Stocks, Funds, Futures, Forex, Crypto, Indices, Bonds, Economy, Options) | M | Core |
| Exchange / Source filter | Filter by exchange/country | S | High |
| Type-to-search | Start typing on the chart = the search opens | S | High |
| Recent searches | List of recent searches | S | Medium |
| Futures contracts expansion | Show futures contracts and continuous (1!, 2!) | M | Low |
| Spread input | Type a math expression in the same field | M | Medium |
| Logos / badges | Logo and type/exchange next to each result | S | Medium |

### 5.9 Undo/Redo, Object tree, Data window

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Undo / Redo | Ctrl+Z / Ctrl+Y for drawings, indicators, settings, symbol changes; buttons in the top toolbar | M | Core |
| Object tree | Hierarchical list of panes > series/indicators/drawings; drag to reorder; lock/hide/delete/group | M | High |
| Data window | OHLCV values and all indicators under the crosshair for all panes (a tab next to Object tree) | S | High |

### 5.10 Screenshots, sharing, publish

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Download image | Save the chart as PNG (Ctrl+Alt+S) | M | High |
| Copy image | Copy the image to the clipboard (Ctrl+Shift+S) | S | High |
| Copy link to chart image | Upload a snapshot and copy the link (Alt+S) | M | Medium |
| Open in new tab / Tweet image | Open the snapshot or share on X | S | Low |
| Publish idea | Publish the chart with text as an Idea (public/private) — outside the core | L | Low |
| Share layout link | Layout link (live version) | M | Medium |

### 5.11 Important keyboard shortcuts

| Shortcut | Action |
|---|---|
| Type letters / Ctrl+K | Change symbol / Quick search |
| Type a number or `,` | Change interval |
| `/` | Indicators dialog |
| `.` / Ctrl+S | Load layout / Save layout |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| ← / → , Ctrl+← / Ctrl+→ | Move one candle / move further |
| Ctrl+↑ / Ctrl+↓ , Ctrl+Wheel | Zoom in/out |
| Shift+Wheel | Horizontal scroll |
| Alt+G | Go to date |
| Alt+R | Reset chart |
| Alt+I / Alt+L / Alt+P | Invert / Log / Percent scale |
| Alt+S | Snapshot + copy URL |
| Alt+T / H / V / C / F | Trend line / Horizontal / Vertical / Cross line / Fib retracement |
| Alt+Shift+R | Rectangle |
| Ctrl+Alt+H | Hide all drawings |
| Ctrl+C / Ctrl+V , Ctrl+Drag | Copy/paste / clone a drawing |
| Shift+Click | Quick Measure |
| Del / Backspace | Delete the selected drawing |
| Alt+Enter , Tab / Shift+Tab | Maximize the active chart / move between charts |
| Alt+W | Add to watchlist |
| Alt+A | ⚠️ Create alert |
| Shift+↓ / Shift+→ | Replay: play-pause / step |
| Dbl-click on pane / Ctrl+Dbl-click | Maximize / Collapse a pane |
| Ctrl+? (or Cmd+?) | ⚠️ Show the shortcuts list |

### 5.12 Basic chart interactions (implicit items that must be built)

| Feature | What it does (1 line) | Complexity | Priority |
|---|---|---|---|
| Pan / zoom (mouse, touch, wheel) | Drag, scroll, pinch; kinetic scroll | M | Core |
| Crosshair + axis labels | Crosshair with price and time labels on the axes | S | Core |
| Lazy loading history | Load older candles when scrolling left | M | Core |
| Real-time bar updates | Update the last candle with live ticks | M | Core |
| Panes (multi-pane) | Separate panes for indicators with splitter, maximize, collapse, move up/down | M | Core |
| Context menu | Right-click: Reset, Copy price, Add alert, Settings, Remove, Visual order, … | M | High |
| Scroll to realtime button | The »» button to jump to the latest candle | S | High |
| Volume overlay | Volume as a histogram at the bottom of the main pane | S | Core |
| Light / Dark theme | Light and dark themes | S | High |

---

## Sources

- https://in.tradingview.com/support/solutions/43000703407 — Chart types available on TradingView
- https://tradingview.com/support/solutions/43000703396-drawing-tools — Drawing tools (7 groups + utilities)
- https://www.tradingview.com/charting-library-docs/v27/ui_elements/drawings/Drawings-List/ — Drawings list (Charting Library)
- https://tradingview.com/support/solutions/43000748166-how-to-configure-your-supercharts — Chart settings tabs
- https://tradingview.com/support/solutions/43000746464 — Supercharts: all you need to know
- https://www.tradingview.com/support/solutions/43000712747-bar-replay-how-and-why-to-test-a-strategy-in-the-past/ — Bar Replay
- https://in.tradingview.com/support/solutions/43000474024 — How do I turn Bar Replay on?
- https://www.tradingview.com/blog/en/intervals-in-bar-replay-50381 — Replay intervals
- https://www.tradingview.com/charting-library-docs/v29/getting_started/Shortcuts — Keyboard shortcuts
- https://in.tradingview.com/support/solutions/43000629992 — How to sync the charts of my layout
- https://tradingview.com/support/solutions/43000694474-why-chart-connections-are-limited — Charts per layout by plan
- https://www.tradingview.com/blog/en/new-chart-layout-patterns-45487 — New chart layout patterns
- https://www.tradingview.com/blog/en/new-chart-type-volume-footprint-44399 — Volume footprint
- https://www.tradingview.com/blog/en/expanded-tick-chart-support-52342 — Tick charts
- https://in.tradingview.com/support/solutions/43000660419-i-want-to-customize-the-visibility-for-several-objects/ — Visibility for several objects
- https://in.tradingview.com/support/solutions/43000686263-how-to-quickly-adjust-visibility-of-a-drawing-or-indicator/ — Quick visibility
- https://www.tradingview.com/blog/en/faster-setup-of-visibility-on-intervals-34613 — Visibility on intervals
- https://www.tradingview.com/blog/en/brand-new-drawing-tool-highlighter-21947 — Highlighter
- https://www.tradingview.com/blog/en/new-settings-for-drawing-tools-on-tradingview-17920 — Drawing text settings
- https://br.tradingview.com/charting-library-docs/latest/ui_elements/Price-Scale — Price scale (Charting Library)
- https://fxnewsgroup.com/forex-news/platforms/tradingview-adds-session-volume-profile-to-lineup-of-chart-types/ — SVP (secondary)
- https://fxnewsgroup.com/forex-news/platforms/tradingview-introduces-time-price-opportunity-chart-type/ — TPO (secondary)
- https://nexusfi.com/a/platforms/tradingview-spread-charts — Spread charts (secondary)
