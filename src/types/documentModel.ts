export interface DocumentModel {
  version: 2;
  canvas: CanvasConfig;
  components: Component[];
}

export interface CanvasConfig {
  width: number;       // in points (1pt = 1/72 inch)
  height: number;      // in points
  background: string;  // hex color, default "#FFFFFF"
  grid: GridConfig;
}

export interface GridConfig {
  enabled: boolean;
  size: number;        // grid cell size in pixels at 100% zoom
  snap: boolean;
  visible: boolean;
}

// ─── Component Base ──────────────────────────────────────────────────────────

export interface BaseComponent {
  id: string;          // uuid, client-generated
  type: ComponentType;
  pageNumber: number;  // 1-indexed
  zIndex: number;
  isVisible: boolean;
  isLocked: boolean;

  // Position and size in points
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;    // degrees, 0 by default
}

export type ComponentType =
  | 'TEXT'
  | 'STATIC_TEXT'
  | 'IMAGE'
  | 'QR_CODE'
  | 'BARCODE'
  | 'SHAPE_RECT'
  | 'SHAPE_ELLIPSE'
  | 'LINE';

// ─── Text Component ──────────────────────────────────────────────────────────

export interface TextComponent extends BaseComponent {
  type: 'TEXT';
  fieldKey: string;      // maps to Excel column key
  label: string;         // human label, e.g. "Student Name"
  sampleValue: string;   // shown in placeholder/dummy preview
  typography: TypographyProps;
  padding: PaddingProps;
  overflow: OverflowBehavior;
}

// ─── Static Text Component ───────────────────────────────────────────────────

export interface StaticTextComponent extends BaseComponent {
  type: 'STATIC_TEXT';
  content: string;       // fixed text, no dynamic binding
  typography: TypographyProps;
  padding: PaddingProps;
  overflow: OverflowBehavior;
}

// ─── Image Component ─────────────────────────────────────────────────────────

export interface ImageComponent extends BaseComponent {
  type: 'IMAGE';
  src: string;           // static URL for static images
  fieldKey?: string;     // optional: bind to Excel column containing image URL
  objectFit: 'fill' | 'contain' | 'cover';
  borderRadius: number;
}

// ─── QR Code Component ───────────────────────────────────────────────────────

export interface QRCodeComponent extends BaseComponent {
  type: 'QR_CODE';
  fieldKey: string;      // Excel column whose value becomes the QR content
  errorCorrection: 'L' | 'M' | 'Q' | 'H';
  foregroundColor: string;
  backgroundColor: string;
}

// ─── Shape Components ────────────────────────────────────────────────────────

export interface ShapeComponent extends BaseComponent {
  type: 'SHAPE_RECT' | 'SHAPE_ELLIPSE';
  fill: string;
  stroke: string;
  strokeWidth: number;
  borderRadius?: number;  // only SHAPE_RECT
  opacity: number;
}

export interface LineComponent extends BaseComponent {
  type: 'LINE';
  stroke: string;
  strokeWidth: number;
  strokeDashArray: number[];  // empty = solid
}

// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface TypographyProps {
  fontFamily: 'Helvetica' | 'Helvetica-Bold' | 'Times-Roman' | 'Times-Bold' | 'Courier' | 'Courier-Bold';
  fontSize: number;       // pt
  fontWeight: 'normal' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;          // hex
  textAlign: 'left' | 'center' | 'right';
  verticalAlign: 'top' | 'middle' | 'bottom';
  lineHeight: number;     // multiplier, e.g. 1.2
  letterSpacing: number;  // pt
}

export interface PaddingProps {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type OverflowBehavior = 'clip' | 'ellipsis' | 'wrap' | 'auto-shrink';

// ─── Union Type ───────────────────────────────────────────────────────────────

export type Component =
  | TextComponent
  | StaticTextComponent
  | ImageComponent
  | QRCodeComponent
  | ShapeComponent
  | LineComponent;
