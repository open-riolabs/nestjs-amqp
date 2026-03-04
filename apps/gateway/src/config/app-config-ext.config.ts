import { AppConfig } from "@open-rlb/nestjs-amqp";

export interface AppConfigExt extends AppConfig {
  port: number;
  host: string;
}