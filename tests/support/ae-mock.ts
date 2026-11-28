// Mock After Effects object model for host tests.
//
// The host runs inside ExtendScript, but the tool handlers are plain modules.
// This mock installs the globals those handlers touch so the real code can run
// under Node: `app`, `CompItem`, `FootageItem`, layer classes, property
// values, and a render queue. Keep it small but faithful: when a test fails
// because the mock is missing a field, add the field instead of special-casing
// the tool.

 

let nextItemId = 100;
let nextLayerId = 1;

export const PropertyValueType = {
  NO_VALUE: 0,
  ThreeD_SPATIAL: 1,
  ThreeD: 2,
  TwoD_SPATIAL: 3,
  TwoD: 4,
  OneD: 5,
  COLOR: 6,
  CUSTOM_VALUE: 7,
  MARKER: 8,
  LAYER_INDEX: 9,
  MASK_INDEX: 10,
  SHAPE: 11,
  TEXT_DOCUMENT: 12,
};

export const MaskMode = {
  NONE: 0,
  ADD: 1,
  SUBTRACT: 2,
  INTERSECT: 3,
  LIGHTEN: 4,
  DARKEN: 5,
  DIFFERENCE: 6,
};

export const BlendingMode = {
  NORMAL: 1,
  ADD: 2,
  MULTIPLY: 3,
  SCREEN: 4,
  OVERLAY: 5,
};

export const KeyframeInterpolationType = {
  LINEAR: 6612,
  BEZIER: 6613,
  HOLD: 6614,
};

export const RQItemStatus = {
  WILL_CONTINUE: 3011,
  NEEDS_OUTPUT: 3013,
  UNQUEUED: 3014,
  QUEUED: 3015,
  RENDERING: 3016,
  USER_STOPPED: 3017,
  ERR_STOPPED: 3018,
  ERR_INVALID_OUTPUT_PATH: 3019,
  DONE: 3020,
};

export const ParagraphJustification = {
  LEFT_JUSTIFY: 0,
  CENTER_JUSTIFY: 1,
  RIGHT_JUSTIFY: 2,
  FULL_JUSTIFY: 3,
};

export class KeyframeEase {
  speed: number;
  influence: number;
  constructor(speed: number, influence: number) {
    this.speed = speed;
    this.influence = influence;
  }
}

export class Shape {
  vertices: number[][];
  closed: boolean;
  constructor(vertices: number[][] = [], closed = true) {
    this.vertices = vertices;
    this.closed = closed;
  }
}

export class MockTextDocument {
  text: string;
  font = "Arial";
  fontSize = 48;
  fillColor = [1, 1, 1];
  applyFill = true;
  strokeColor = [0, 0, 0];
  applyStroke = false;
  strokeWidth = 0;
  tracking = 0;
  leading = 0;
  justification = ParagraphJustification.LEFT_JUSTIFY;
  fauxBold = false;
  fauxItalic = false;
  allCaps = false;
  boxText = false;
  constructor(text = "") {
    this.text = text;
  }
}

function cloneValue(value: any): any {
  if (value instanceof Array) return value.map(cloneValue);
  if (value instanceof MockTextDocument) {
    const copy = new MockTextDocument(value.text);
    Object.assign(copy, value);
    return copy;
  }
  if (value instanceof Shape) {
    return new Shape(
      value.vertices.map((row) => row.slice()),
      value.closed,
    );
  }
  return value;
}

function vecType(length: number): number {
  if (length === 1) return PropertyValueType.OneD;
  if (length === 2) return PropertyValueType.TwoD_SPATIAL;
  return PropertyValueType.ThreeD_SPATIAL;
}

type ChildFactory = (matchName: string) => MockProperty | null;

export class MockProperty {
  name: string;
  matchName: string;
  propertyIndex = 0;
  propertyValueType: number;
  enabled = true;
  canSetExpression = true;
  expression = "";
  expressionEnabled = false;
  children: MockProperty[] = [];
  keys: { time: number; value: any }[] = [];
  private _value: any;
  _factory: ChildFactory | null = null;
  _parent: MockProperty | null = null;

  constructor(
    name: string,
    matchName: string,
    type: number,
    value: any = null,
  ) {
    this.name = name;
    this.matchName = matchName;
    this.propertyValueType = type;
    this._value = cloneValue(value);
  }

  get value(): any {
    return cloneValue(this._value);
  }

  set value(next: any) {
    this._value = cloneValue(next);
  }

  get numProperties(): number {
    return this.children.length;
  }

  get numKeys(): number {
    return this.keys.length;
  }

  addChild(child: MockProperty): MockProperty {
    child._parent = this;
    this.children.push(child);
    child.propertyIndex = this.children.length;
    return child;
  }

  property(token: string | number): MockProperty | null {
    if (typeof token === "number") {
      return this.children[token - 1] || null;
    }
    const text = String(token);
    for (const child of this.children) {
      if (child.name === text || child.matchName === text) return child;
    }
    const lower = text.toLowerCase();
    for (const child of this.children) {
      if (
        child.name.toLowerCase() === lower ||
        child.matchName.toLowerCase() === lower
      ) {
        return child;
      }
    }
    for (const child of this.children) {
      if (!child.numProperties) continue;
      const nested = child.property(token);
      if (nested) return nested;
    }
    return null;
  }

  addProperty(matchName: string): MockProperty {
    if (this._factory) {
      const created = this._factory(matchName);
      if (!created) throw new Error("Cannot add property " + matchName);
      this.addChild(created);
      return created;
    }
    const created = new MockProperty(matchName, matchName, PropertyValueType.NO_VALUE);
    this.addChild(created);
    return created;
  }

  canAddProperty(): boolean {
    return !!this._factory;
  }

  setValue(value: any): void {
    this._value = cloneValue(value);
  }

  setValueAtTime(time: number, value: any): void {
    const at = Number(time) || 0;
    const existing = this.keys.findIndex((key) => Math.abs(key.time - at) < 1e-6);
    const found = existing >= 0 ? this.keys[existing] : undefined;
    if (found) found.value = cloneValue(value);
    else {
      this.keys.push({ time: at, value: cloneValue(value) });
      this.keys.sort((a, b) => a.time - b.time);
    }
    this._value = cloneValue(value);
  }

  keyTime(index: number): number {
    const key = this.keys[index - 1];
    if (!key) throw new Error("No keyframe at index " + index);
    return key.time;
  }

  keyValue(index: number): any {
    const key = this.keys[index - 1];
    if (!key) throw new Error("No keyframe at index " + index);
    return cloneValue(key.value);
  }

  nearestKeyIndex(time: number): number {
    if (!this.keys.length) return 0;
    let best = 1;
    let distance = Infinity;
    for (let i = 0; i < this.keys.length; i += 1) {
      const key = this.keys[i];
      if (!key) continue;
      const delta = Math.abs(key.time - time);
      if (delta < distance) {
        distance = delta;
        best = i + 1;
      }
    }
    return best;
  }

  removeKey(index: number): void {
    this.keys.splice(index - 1, 1);
  }

  setInterpolationTypeAtKey(): void {
    // no-op
  }

  setTemporalEaseAtKey(): void {
    // no-op
  }

  remove(): void {
    const parent = this._parent;
    if (!parent) return;
    const at = parent.children.indexOf(this);
    if (at >= 0) parent.children.splice(at, 1);
    parent.children.forEach((child, index) => {
      child.propertyIndex = index + 1;
    });
  }
}

function group(name: string, matchName = name): MockProperty {
  return new MockProperty(name, matchName, PropertyValueType.NO_VALUE);
}

function vector(name: string, value: any = [], matchName = name): MockProperty {
  return new MockProperty(name, matchName, vecType(value.length), value);
}

function numberProp(name: string, value: number, matchName = name): MockProperty {
  return new MockProperty(name, matchName, PropertyValueType.OneD, value);
}

function transformGroup(position: number[] = [0, 0, 0]): MockProperty {
  const transform = group("Transform", "ADBE Transform Group");
  transform.addChild(vector("Anchor Point", [0, 0, 0], "ADBE Anchor Point"));
  transform.addChild(vector("Position", position, "ADBE Position"));
  transform.addChild(
    new MockProperty("Scale", "ADBE Scale", PropertyValueType.ThreeD, [100, 100, 100]),
  );
  transform.addChild(numberProp("Rotation", 0, "ADBE Rotate Z"));
  transform.addChild(numberProp("Opacity", 100, "ADBE Opacity"));
  return transform;
}

const EFFECT_DEFS: Record<string, { name: string; props: [string, number, any][] }> = {
  "ADBE Glo2": {
    name: "Glow",
    props: [
      ["Glow Threshold", PropertyValueType.OneD, 60],
      ["Glow Radius", PropertyValueType.OneD, 25],
      ["Glow Intensity", PropertyValueType.OneD, 1],
    ],
  },
  "ADBE Gaussian Blur 2": {
    name: "Gaussian Blur",
    props: [
      ["Blurriness", PropertyValueType.OneD, 0],
      ["Blur Dimensions", PropertyValueType.OneD, 1],
    ],
  },
  "ADBE Fill": {
    name: "Fill",
    props: [["Color", PropertyValueType.COLOR, [1, 0, 0]]],
  },
};

function effectParade(): MockProperty {
  const parade = group("Effects", "ADBE Effect Parade");
  parade._factory = (matchName: string) => {
    const def = EFFECT_DEFS[matchName] || {
      name: matchName,
      props: [["Amount", PropertyValueType.OneD, 50]] as [string, number, any][],
    };
    const effect = group(def.name, matchName);
    effect.enabled = true;
    for (const [propName, type, value] of def.props) {
      effect.addChild(new MockProperty(propName, propName, type, value));
    }
    return effect;
  };
  return parade;
}

function maskParade(): MockProperty {
  const parade = group("Masks", "ADBE Mask Parade");
  parade._factory = (matchName: string) => {
    if (matchName !== "ADBE Mask Atom") return null;
    const mask = group("Mask " + (parade.children.length + 1), "ADBE Mask Atom");
    mask.addChild(new MockProperty("Mask Shape", "ADBE Mask Shape", PropertyValueType.SHAPE, new Shape()));
    mask.addChild(vector("Mask Feather", [10, 10], "ADBE Mask Feather"));
    mask.addChild(numberProp("Mask Opacity", 100, "ADBE Mask Opacity"));
    mask.addChild(numberProp("Mask Offset", 0, "ADBE Mask Offset"));
    (mask as any).maskMode = MaskMode.ADD;
    (mask as any).inverted = false;
    return mask;
  };
  return parade;
}

let vectorGroupId = 1;

function vectorFactory(): ChildFactory {
  return (matchName: string) => {
    if (matchName === "ADBE Vector Group") {
      const created = group("Group " + vectorGroupId++, "ADBE Vector Group");
      const vectors = group("Vectors", "ADBE Vectors Group");
      vectors._factory = vectorFactory();
      created.addChild(vectors);
      created.addChild(transformGroup());
      return created;
    }
    if (matchName === "ADBE Vector Shape - Rect") {
      const created = group("Rectangle Path", "ADBE Vector Shape - Rect");
      created.addChild(new MockProperty("Size", "ADBE Vector Rect Size", PropertyValueType.TwoD, [100, 100]));
      created.addChild(numberProp("Roundness", 0, "ADBE Vector Rect Roundness"));
      return created;
    }
    if (matchName === "ADBE Vector Shape - Ellipse") {
      const created = group("Ellipse Path", "ADBE Vector Shape - Ellipse");
      created.addChild(new MockProperty("Size", "ADBE Vector Ellipse Size", PropertyValueType.TwoD, [100, 100]));
      return created;
    }
    if (matchName === "ADBE Vector Shape - Star") {
      const created = group("Polystar Path", "ADBE Vector Shape - Star");
      created.addChild(numberProp("Points", 5, "ADBE Vector Star Points"));
      created.addChild(numberProp("Outer Radius", 50, "ADBE Vector Star Outer Radius"));
      created.addChild(numberProp("Inner Radius", 25, "ADBE Vector Star Inner Radius"));
      created.addChild(numberProp("Star Type", 1, "ADBE Vector Star Type"));
      return created;
    }
    if (matchName === "ADBE Vector Shape - Group") {
      const created = group("Path", "ADBE Vector Shape - Group");
      created.addChild(new MockProperty("Path", "ADBE Vector Shape", PropertyValueType.SHAPE, new Shape()));
      return created;
    }
    if (matchName === "ADBE Vector Graphic - Fill") {
      const created = group("Fill", "ADBE Vector Graphic - Fill");
      created.enabled = true;
      created.addChild(new MockProperty("Color", "ADBE Vector Fill Color", PropertyValueType.COLOR, [1, 0, 0]));
      return created;
    }
    if (matchName === "ADBE Vector Graphic - Stroke") {
      const created = group("Stroke", "ADBE Vector Graphic - Stroke");
      created.enabled = true;
      created.addChild(new MockProperty("Color", "ADBE Vector Stroke Color", PropertyValueType.COLOR, [0, 0, 0]));
      created.addChild(numberProp("Stroke Width", 1));
      return created;
    }
    return null;
  };
}

export class MockLayer {
  id = nextLayerId++;
  comp: MockComp;
  name: string;
  kind: string;
  source: any = null;
  adjustmentLayer = false;
  hasVideo = true;
  hasAudio = false;
  blendingMode = BlendingMode.NORMAL;
  enabled = true;
  locked = false;
  solo = false;
  shy = false;
  selected = false;
  inPoint = 0;
  outPoint = 0;
  startTime = 0;
  stretch = 100;
  parent: MockLayer | null = null;
  label = 1;
  comment = "";
  zoom = 500;
  _props: MockProperty[] = [];

  constructor(comp: MockComp, name: string, kind: string) {
    this.comp = comp;
    this.name = name;
    this.kind = kind;
     
    this.outPoint = comp.duration;
    this._props.push(transformGroup([comp.width / 2, comp.height / 2, 0]));
    this._props.push(effectParade());
    if (kind === "text") {
      const text = group("Text", "ADBE Text Properties");
      text.addChild(
        new MockProperty("Source Text", "Source Text", PropertyValueType.TEXT_DOCUMENT, new MockTextDocument(name)),
      );
      this._props.push(text);
    }
    if (kind === "shape") {
      const contents = group("Contents", "ADBE Root Vectors Group");
      contents._factory = vectorFactory();
      this._props.push(contents);
    }
    if (kind === "camera") {
      const options = group("Camera Options", "ADBE Camera Options Group");
      options.addChild(numberProp("Zoom", 500));
      this._props.push(options);
      this.hasVideo = false;
    }
    if (kind === "light") {
      const options = group("Light Options", "ADBE Light Options Group");
      options.addChild(numberProp("Intensity", 100));
      this._props.push(options);
      this.hasVideo = false;
    }
    if (kind !== "camera" && kind !== "light") {
      this._props.push(maskParade());
    }
  }

  get index(): number {
    return this.comp._layers.indexOf(this) + 1;
  }

  property(token: string | number): MockProperty | null {
    if (typeof token === "number") return this._props[token - 1] || null;
    const text = String(token);
    for (const prop of this._props) {
      if (prop.name === text || prop.matchName === text) return prop;
    }
    const lower = text.toLowerCase();
    for (const prop of this._props) {
      if (
        prop.name.toLowerCase() === lower ||
        prop.matchName.toLowerCase() === lower
      ) {
        return prop;
      }
    }
    for (const prop of this._props) {
      const found = prop.property(token);
      if (found) return found;
    }
    return null;
  }

  remove(): void {
    const at = this.comp._layers.indexOf(this);
    if (at >= 0) this.comp._layers.splice(at, 1);
  }

  moveToBeginning(): void {
    const at = this.comp._layers.indexOf(this);
    if (at > 0) {
      this.comp._layers.splice(at, 1);
      this.comp._layers.unshift(this);
    }
  }

  moveToEnd(): void {
    const at = this.comp._layers.indexOf(this);
    if (at >= 0 && at < this.comp._layers.length - 1) {
      this.comp._layers.splice(at, 1);
      this.comp._layers.push(this);
    }
  }

  moveBefore(other: MockLayer): void {
    this.moveRelative(other, 0);
  }

  moveAfter(other: MockLayer): void {
    this.moveRelative(other, 1);
  }

  private moveRelative(other: MockLayer, offset: number): void {
    const at = this.comp._layers.indexOf(this);
    if (at >= 0) this.comp._layers.splice(at, 1);
    const target = this.comp._layers.indexOf(other) + offset;
    this.comp._layers.splice(target, 0, this);
  }

  duplicate(): MockLayer {
    const copy = this.comp.addLayer(this.name + " 2", this.kind);
    copy.source = this.source;
    copy.inPoint = this.inPoint;
    copy.outPoint = this.outPoint;
    copy.startTime = this.startTime;
    copy.stretch = this.stretch;
    copy.enabled = this.enabled;
    const at = this.comp._layers.indexOf(this);
    this.comp._layers.splice(this.comp._layers.indexOf(copy), 1);
    this.comp._layers.splice(at + 1, 0, copy);
    return copy;
  }
}

export class MockAVLayer extends MockLayer {
  constructor(comp: MockComp, name: string, kind = "av") {
    super(comp, name, kind);
  }
}

export class MockTextLayer extends MockLayer {
  constructor(comp: MockComp, name: string) {
    super(comp, name, "text");
  }
}

export class MockShapeLayer extends MockLayer {
  constructor(comp: MockComp, name: string) {
    super(comp, name, "shape");
  }
}

export class MockCameraLayer extends MockLayer {
  constructor(comp: MockComp, name: string) {
    super(comp, name, "camera");
  }
}

export class MockLightLayer extends MockLayer {
  constructor(comp: MockComp, name: string) {
    super(comp, name, "light");
  }
}

export class MockComp {
  id = nextItemId++;
  name: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
  pixelAspect = 1;
  time = 0;
  workAreaStart = 0;
  bgColor = [0, 0, 0];
  resolutionFactor = [1, 1];
  motionBlur = false;
  shutterAngle = 180;
  comment = "";
  parentFolder: MockFolder | null = null;
  _layers: MockLayer[] = [];

  layers = {
    addSolid: (
      color: number[],
      name: string,
      width: number,
      height: number,
      pixelAspect: number,
      duration: number,
    ) => {
      const source = new MockFootage(name, width, height, duration);
      source.mainSource = new SolidSource(name, color, width, height);
      this.compProject?._items.push(source);
      const layer = this.addLayer(name, "av", duration);
      layer.source = source;
      return layer;
    },
    addText: (text: string) => {
      const layer = this.addLayer(text || "Text", "text");
      const doc = new MockTextDocument(text || "Text");
      layer.property("Source Text")!.setValue(doc);
      return layer;
    },
    addShape: () => this.addLayer("Shape", "shape"),
    addNull: (duration?: number) => this.addLayer("Null", "av", duration),
    addCamera: (name: string, center: number[]) => {
      const layer = this.addLayer(name, "camera");
      layer.property("ADBE Camera Options Group")!.property("Zoom")!.setValue(500);
      (layer as any).center = center;
      return layer;
    },
    addLight: (name: string, center: number[]) => {
      const layer = this.addLayer(name, "light");
      (layer as any).center = center;
      return layer;
    },
    add: (item: any, duration?: number) => {
      const layer = this.addLayer(item.name || "Layer", "av", duration);
      layer.source = item;
      return layer;
    },
  };

  constructor(name: string, width = 1920, height = 1080, frameRate = 30, duration = 10) {
    this.name = name;
    this.width = width;
    this.height = height;
    this.frameRate = frameRate;
    this.duration = duration;
    this.bgColor = [0, 0, 0];
  }

  get compProject(): MockProject | null {
    return MockProject.current;
  }

  addLayer(name: string, kind: string, duration?: number): MockLayer {
    const LayerClass =
      kind === "text"
        ? MockTextLayer
        : kind === "shape"
          ? MockShapeLayer
          : kind === "camera"
            ? MockCameraLayer
            : kind === "light"
              ? MockLightLayer
              : MockAVLayer;
    const layer = new (LayerClass as any)(this, name, kind);
    if (typeof duration === "number") {
      layer.inPoint = 0;
      layer.outPoint = duration;
    }
    this._layers.unshift(layer);
    return layer;
  }

  get numLayers(): number {
    return this._layers.length;
  }

  layer(index: number): MockLayer {
    const layer = this._layers[index - 1];
    if (!layer) throw new Error("No layer at index " + index);
    return layer;
  }

  get selectedLayers(): MockLayer[] {
    return this._layers.filter((layer) => layer.selected);
  }

  get selectedProperties(): MockProperty[] {
    return [];
  }

  openInViewer(): MockComp {
    if (MockProject.current) MockProject.current.activeItem = this;
    return this;
  }

  saveFrameToPng(time: number, file: MockFile): void {
    if (file.parent && !file.parent.exists) file.parent.create();
    file.write("mock-png");
  }

  remove(): void {
    MockProject.current?.removeItem(this);
  }
}

export class MockFootage {
  id = nextItemId++;
  name: string;
  width: number;
  height: number;
  duration: number;
  mainSource: any = null;
  file: MockFile | null = null;
  footageMissing = false;
  comment = "";
  parentFolder: MockFolder | null = null;

  constructor(name: string, width = 1920, height = 1080, duration = 10) {
    this.name = name;
    this.width = width;
    this.height = height;
    this.duration = duration;
  }

  replace(file: MockFile): void {
    this.file = file;
    this.mainSource = { file };
    this.footageMissing = false;
  }

  remove(): void {
    MockProject.current?.removeItem(this);
  }
}

export class MockFolder {
  id = nextItemId++;
  name: string;
  comment = "";
  parentFolder: MockFolder | null = null;

  constructor(name: string) {
    this.name = name;
  }

  remove(): void {
    MockProject.current?.removeItem(this);
  }
}

export class MockFile {
  fsName: string;
  name: string;
  parent: MockFolderPath;
  constructor(path: string) {
    this.fsName = String(path).replace(/\\/g, "/");
    this.name = this.fsName.split("/").pop() || this.fsName;
    const dir = this.fsName.slice(0, Math.max(0, this.fsName.lastIndexOf("/")));
    this.parent = new MockFolderPath(dir || ".");
  }

  get exists(): boolean {
    return existsSync(this.fsName);
  }

  write(text: string): void {
    mkdirSync(this.parent.fsName, { recursive: true });
    writeFileSync(this.fsName, text);
  }
}

export class MockFolderPath {
  fsName: string;
  constructor(path: string) {
    this.fsName = String(path).replace(/\\/g, "/");
  }

  get exists(): boolean {
    return existsSync(this.fsName);
  }

  create(): void {
    mkdirSync(this.fsName, { recursive: true });
  }
}

export class ImportOptions {
  file: MockFile;
  sequence = false;
  forceAlphabetical = false;
  importAs = null;
  constructor(file: MockFile) {
    this.file = file;
  }
}

export class SolidSource {
  name: string;
  color: number[];
  width: number;
  height: number;
  constructor(name: string, color: number[], width: number, height: number) {
    this.name = name;
    this.color = color;
    this.width = width;
    this.height = height;
  }
}

export class PlaceholderSource {
  name: string;
  width: number;
  height: number;
  constructor(name: string, width: number, height: number) {
    this.name = name;
    this.width = width;
    this.height = height;
  }
}

const TEMPLATES = [
  "Lossless",
  "High Quality",
  "H.264 - Match Render Settings -  5 Mbps",
  "H.264 - Match Render Settings - 15 Mbps",
  "MPEG-4 Video",
];

class MockOutputModule {
  name = "Lossless";
  template = "Lossless";
  file: MockFile | null = null;
  templates = TEMPLATES.slice();
  applyTemplate(template: string): void {
    if (!TEMPLATES.includes(template)) throw new Error('Invalid template "' + template + '"');
    this.template = template;
    this.name = template;
  }
}

class MockRQItem {
  comp: MockComp;
  rq: MockRenderQueue;
  private _status: number | null = null;
  _outputModules: MockOutputModule[] = [new MockOutputModule()];

  constructor(rq: MockRenderQueue, comp: MockComp) {
    this.rq = rq;
    this.comp = comp;
  }

  get index(): number {
    return this.rq._items.indexOf(this) + 1;
  }

  get numOutputModules(): number {
    return this._outputModules.length;
  }

  outputModule(index: number): MockOutputModule {
    const module = this._outputModules[index - 1];
    if (!module) throw new Error("No output module at index " + index);
    return module;
  }

  get status(): number {
    if (this._status !== null) return this._status;
    return this.outputModule(1).file ? RQItemStatus.QUEUED : RQItemStatus.NEEDS_OUTPUT;
  }

  set status(value: number) {
    this._status = value;
  }

  applyTemplate(template: string): void {
    this.outputModule(1).applyTemplate(template);
  }

  remove(): void {
    this.rq.removeItem(this);
  }
}

class MockRenderQueue {
  _items: MockRQItem[] = [];
  rendering = false;

  items = {
    add: (comp: MockComp) => {
      const item = new MockRQItem(this, comp);
      this._items.push(item);
      return item;
    },
  };

  get numItems(): number {
    return this._items.length;
  }

  item(index: number): MockRQItem {
    const item = this._items[index - 1];
    if (!item) throw new Error("No render-queue item at index " + index);
    return item;
  }

  removeItem(item: MockRQItem): void {
    const at = this._items.indexOf(item);
    if (at >= 0) this._items.splice(at, 1);
  }

  render(): void {
    this.rendering = true;
    try {
      for (const item of this._items) {
        if (item.status === RQItemStatus.NEEDS_OUTPUT) continue;
        item.status = RQItemStatus.DONE;
      }
    } finally {
      this.rendering = false;
    }
  }
}

export class MockProject {
  static current: MockProject | null = null;
  file: MockFile | null = null;
  activeItem: MockComp | null = null;
  selection: any[] = [];
  bitsPerChannel = 8;
  bgColor = [0, 0, 0];
  dirty = false;
  renderQueue = new MockRenderQueue();
  _items: any[] = [];

  items = {
    addComp: (
      name: string,
      width: number,
      height: number,
      pixelAspect: number,
      duration: number,
      frameRate: number,
    ) => {
      const comp = new MockComp(name, width, height, frameRate, duration);
      comp.pixelAspect = pixelAspect;
      comp.parentFolder = MockProject.rootFolder;
      this._items.push(comp);
      return comp;
    },
    addFolder: (name: string) => {
      const folder = new MockFolder(name);
      folder.parentFolder = MockProject.rootFolder;
      this._items.push(folder);
      return folder;
    },
  };

  static rootFolder = new MockFolder("Root");

  get numItems(): number {
    return this._items.length;
  }

  item(index: number): any {
    const item = this._items[index - 1];
    if (!item) throw new Error("No project item at index " + index);
    return item;
  }

  importFile(options: ImportOptions): MockFootage {
    const file = options.file;
    const item = new MockFootage(file.name, 1920, 1080, 10);
    item.file = file;
    item.mainSource = { file };
    item.parentFolder = MockProject.rootFolder;
    this._items.push(item);
    return item;
  }

  removeItem(item: any): void {
    const at = this._items.indexOf(item);
    if (at >= 0) this._items.splice(at, 1);
  }

  save(file?: MockFile): void {
    if (file) this.file = file;
    this.dirty = false;
  }

  close(): void {
    MockProject.current = null;
  }
}

export type MockAe = {
  project: MockProject;
  comp: MockComp;
  layer: MockLayer;
  renderQueue: MockRenderQueue;
  dispatch: (tool: string, args: Record<string, unknown>) => any;
  reset: () => void;
};

/**
 * Installs the AE globals and returns handles for tests. Call once per test
 * file (before importing the host), then use `reset()` between tests.
 */
export function installAeMock(): MockAe {
  const project = new MockProject();
  MockProject.current = project;
  const comp = project.items.addComp("Main", 1920, 1080, 1, 10, 30);
  project.activeItem = comp;
  const layer = comp.layers.addSolid([1, 1, 1], "Solid 1", 1920, 1080, 1, 10);
  layer.selected = true;

  const globals: Record<string, unknown> = {
    app: {
      project,
      version: "23.6x62",
      effects: [
        { displayName: "Glow", matchName: "ADBE Glo2", category: "Stylize" },
        { displayName: "Gaussian Blur", matchName: "ADBE Gaussian Blur 2", category: "Blur & Sharpen" },
        { displayName: "Fill", matchName: "ADBE Fill", category: "Generate" },
      ],
      open: () => project,
      beginUndoGroup: () => undefined,
      endUndoGroup: () => undefined,
    },
    CompItem: MockComp,
    FootageItem: MockFootage,
    FolderItem: MockFolder,
    TextLayer: MockTextLayer,
    ShapeLayer: MockShapeLayer,
    AVLayer: MockAVLayer,
    CameraLayer: MockCameraLayer,
    LightLayer: MockLightLayer,
    PropertyValueType,
    MaskMode,
    BlendingMode,
    RQItemStatus,
    KeyframeInterpolationType,
    KeyframeEase,
    ParagraphJustification,
    Shape,
    SolidSource,
    PlaceholderSource,
    ImportOptions,
    File: MockFile,
    Folder: Object.assign(MockFolderPath, { temp: new MockFolderPath(process.cwd()) }),
  };

  for (const [key, value] of Object.entries(globals)) {
    (globalThis as any)[key] = value;
  }

  const reset = (): void => {
    project._items = [];
    project.activeItem = null;
    project.file = null;
    project.selection = [];
    project.renderQueue._items = [];
    project.renderQueue.rendering = false;
    const nextComp = project.items.addComp("Main", 1920, 1080, 1, 10, 30);
    project.activeItem = nextComp;
    const nextLayer = nextComp.layers.addSolid([1, 1, 1], "Solid 1", 1920, 1080, 1, 10);
    nextLayer.selected = true;
    ae.comp = nextComp;
    ae.layer = nextLayer;
  };

  const ae: MockAe = {
    project,
    comp,
    layer,
    renderQueue: project.renderQueue,
    dispatch: () => {
      throw new Error("dispatch not wired; import host and call dispatch directly");
    },
    reset,
  };
  return ae;
}

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
