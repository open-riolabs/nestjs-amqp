import { Injectable } from '@nestjs/common';
import { MetadataScannerService } from './metadata-scanner.service';

@Injectable()
export class AutoDiscoveryService {
  constructor(private readonly metadataScannerService: MetadataScannerService) { }

  get meta() {
    return this.metadataScannerService.metaInfo;
  }
}