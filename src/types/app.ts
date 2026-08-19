export type AppStatus = {
  app_version: string;
  app_data_dir: string;
  database_schema_version: number;
  evidence_count: number;
};

export type ServiceTab = {
  id: "pi" | "dsh" | "skills";
  label: string;
  icon: string;
};

export type ViewId = "pi" | "dsh" | "skills";
