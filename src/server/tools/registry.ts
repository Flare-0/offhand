import { assetsTool } from './assets.js';
import { batchTool } from './batch.js';
import { compTool } from './comp.js';
import { docsTool } from './docs.js';
import { effectTool } from './effect.js';
import { executeTool } from './execute.js';
import { layerTool } from './layer.js';
import { maskTool } from './mask.js';
import { projectTool } from './project.js';
import { propertyTool } from './property.js';
import { renderTool } from './render.js';
import { shapeTool } from './shape.js';
import { statusTool } from './status.js';
import { textTool } from './text.js';
import type { ToolDefinition } from './types.js';
import { viewTool } from './view.js';

export const TOOLS: ToolDefinition[] = [
  statusTool,
  docsTool,
  projectTool,
  compTool,
  layerTool,
  propertyTool,
  effectTool,
  textTool,
  shapeTool,
  maskTool,
  renderTool,
  assetsTool,
  viewTool,
  executeTool,
  batchTool,
];
