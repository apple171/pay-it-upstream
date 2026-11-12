// AG Studio theme matching the ledger page. Every colour is a CSS variable from app/globals.css,
// so Studio, its grids and charts follow the page's light and dark palettes.
import { studioTheme } from "ag-studio";

const v = (name: string) => `var(--${name})`;
const line = (name: string) => ({ width: 1, color: v(name) });

const palette = Object.fromEntries(
  Array.from({ length: 6 }, (_, i) => [
    [`chartPaletteFills${i + 1}Color`, v(`c${i + 1}`)],
    [`chartPaletteStrokes${i + 1}Color`, v(`c${i + 1}`)],
  ]).flat(),
);

export const theme = studioTheme.withParams({
  fontFamily: v("font"),
  fontSize: 14,
  textColor: v("text"),
  foregroundColor: v("text"),
  subtleTextColor: v("muted"),
  backgroundColor: v("card"),
  borderColor: v("line"),
  accentColor: v("accent"),
  iconColor: v("brand"),
  rowHoverColor: v("hover"),

  studioWrapperBorder: false,
  studioWrapperBorderRadius: 0,
  studioWrapperSpacing: 0,
  studioWrapperBackgroundColor: v("bg"),
  studioCanvasBorder: false,
  studioCanvasBorderRadius: 0,
  studioCanvasShadow: false,
  studioCanvasBackgroundColor: v("bg"),
  studioCanvasPadding: 12,
  studioCanvasRowHeight: 18,
  studioCanvasFontFamily: v("font"),

  // Widgets look like the ledger page's tiles: card background, 1px line, 10px radius.
  studioWidgetBackgroundColor: v("card"),
  studioWidgetBorder: line("line"),
  studioWidgetBorderRadius: 10,
  studioWidgetPadding: 12,
  studioWidgetTitleFontFamily: v("font"),
  studioWidgetTitleFontSize: 15,
  studioWidgetTitleFontWeight: 650,
  studioWidgetTitleTextColor: v("brand"),
  studioWidgetSubtitleFontFamily: v("font"),
  studioWidgetSubtitleFontSize: 13,
  studioWidgetSubtitleTextColor: v("muted"),
  studioWidgetCaptionFontFamily: v("font"),
  studioWidgetCaptionFontSize: 12,
  studioWidgetCaptionTextColor: v("muted"),
  studioWidgetResizeBorderColor: v("accent"),

  studioPanelContainerBackgroundColor: v("card"),
  studioPanelContainerBorder: line("line"),
  studioPanelContainerBorderRadius: 0,
  studioPanelDividerColor: v("line"),
  studioPanelDividerActiveColor: v("accent"),
  studioPanelSectionBorderColor: v("line"),
  studioPanelHeaderFontFamily: v("font"),
  studioPanelHeaderFontWeight: 600,
  studioPanelChevronButtonHoverBackgroundColor: v("hover"),
  studioPanelChevronButtonHoverColor: v("accent"),
  studioToggleButtonActiveBackgroundColor: v("hover"),
  studioToggleButtonActiveBorderColor: v("accent"),
  studioToggleButtonActiveColor: v("accent"),

  // Grids: the ledger table's look (muted small-caps headers, light row lines).
  gridFontFamily: v("font"),
  gridFontSize: 14,
  gridCellTextColor: v("text"),
  gridHeaderBackgroundColor: v("card"),
  gridHeaderTextColor: v("muted"),
  gridHeaderFontWeight: 600,
  gridHeaderFontSize: 12,
  gridRowHeight: 38,
  gridRowBorder: line("line"),
  gridHeaderRowBorder: line("line"),
  gridPinnedRowBorder: line("line"),
  gridRowHoverColor: v("hover"),
  gridWrapperBorder: false,

  chartFontFamily: v("font"),
  chartTextColor: v("text"),
  chartSubtleTextColor: v("muted"),
  chartAxisLineColor: v("line"),
  chartGridLineColor: v("line"),
  ...palette,
});

/** Narrow screens: let the canvas shrink to the phone's width. */
export const phoneTheme = theme.withParams({ studioCanvasMinWidth: 320, studioCanvasPadding: 8 });
