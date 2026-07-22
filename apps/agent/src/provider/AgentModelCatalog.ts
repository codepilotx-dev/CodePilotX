import type { Model, Provider } from "@codepilotx/model-schema";
import type { Api, Model as PiModel } from "@earendil-works/pi-ai";

/** The model surface consumed by the Agent and transport layers. */
export interface AgentModelCatalog {
  list(): Promise<readonly Provider.Info[]>;
  models(providerID?: Provider.ID): Promise<readonly Model.Info[]>;
  resolve(ref: Model.Ref): Promise<Model.Info>;
  getModel(ref: Model.Ref): Promise<PiModel<Api>>;
  refresh(force?: boolean): Promise<void>;
  reload(): Promise<void>;
  dispose(): Promise<void>;
}
