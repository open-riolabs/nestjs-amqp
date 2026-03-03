import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { RemoteConfigService } from "./remote-config.service";

@Module({
  imports: [ConfigModule],
  providers: [RemoteConfigService],
})
export class RemoteConfigModule { }