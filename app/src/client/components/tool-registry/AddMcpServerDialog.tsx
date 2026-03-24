/**
 * Re-export AddMcpServerDialog from McpServerSection for module boundary clarity.
 * The implementation lives in McpServerSection.tsx alongside the view-model functions.
 */
export {
  AddMcpServerDialog,
  type AddMcpServerDialogProps,
  type AddMcpServerFormData,
  type McpTransport,
  type AuthMode,
  type StaticHeaderEntry,
  validateAddMcpServerForm,
} from "./McpServerSection";
