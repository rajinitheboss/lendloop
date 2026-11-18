import { RequestsView } from "./requests-view";

// Personal, realtime data rendered in the browser: no static shell to validate.
export const instant = false;

export default function RequestsPage() {
  return <RequestsView />;
}
