import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BrokerModule } from "../broker/broker.module";
import { RemoteConfigService } from "./remote-config.service";

@Module({
  imports: [ConfigModule, BrokerModule],
  providers: [RemoteConfigService],
})
export class RemoteConfigModule { }