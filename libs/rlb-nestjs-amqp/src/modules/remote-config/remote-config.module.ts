import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BrokerModule } from "../broker/broker.module";
import { RemoteConfigService } from "./remote-config.service";
import { ProxyModule } from "../proxy/proxy.module";

@Module({
  imports: [ConfigModule, BrokerModule, ProxyModule],
  providers: [RemoteConfigService],
})
export class RemoteConfigModule { }