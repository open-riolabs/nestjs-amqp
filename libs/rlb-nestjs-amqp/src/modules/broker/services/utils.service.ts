import { Injectable } from "@nestjs/common";

@Injectable()
export class UtilsService {
  error2Object(error: Error & { [k: string]: any; }, devEnv: boolean = true): any {
    const _retErr: { name: string, message: string, [k: string]: any; } = {
      message: error.message,
      name: error.name,
    };
    if (devEnv) {
      _retErr.stack = error.stack;
    }
    Object.keys(error).forEach(k => _retErr[k] = error[k]);
    return _retErr;
  }
}

export interface AppConfig {
  environment: 'development' | 'production' | 'test';
}
