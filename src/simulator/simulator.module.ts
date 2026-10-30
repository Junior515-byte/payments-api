import { Module } from '@nestjs/common';
import { SimulatorController } from './simulator.controller';

@Module({ controllers: [SimulatorController] })
export class SimulatorModule {}
