import type { Model } from "@codepilotx/model-schema";
import type { PiModelService } from "./pi";
import type { AgentModelCatalog } from "./AgentModelCatalog";

/** Keeps the existing RPC catalog shape while all inference uses pi-ai models. */
export class PiModelCatalogAdapter implements AgentModelCatalog {
  constructor(readonly service: PiModelService) {}
  list() {
    return this.service.list();
  }
  models(providerID?: Parameters<PiModelService["models"]>[0]) {
    return this.service.models(providerID);
  }
  resolve(ref: Model.Ref) {
    return this.service.resolve(ref);
  }
  getModel(ref: Model.Ref) {
    return this.service.getPiModel(ref);
  }
  refresh(force = false) {
    return this.service.refresh(force);
  }
  reload() {
    return this.service.reload();
  }
  dispose() {
    return this.service.dispose();
  }
}
