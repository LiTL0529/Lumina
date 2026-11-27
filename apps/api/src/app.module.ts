import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './common/prisma.module';
import { RedisModule } from './common/redis.module';
import { EventsModule } from './common/events.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrgModule } from './modules/org/org.module';
import { ProductModule } from './modules/product/product.module';
import { ClinicModule } from './modules/clinic/clinic.module';
import { TraceModule } from './modules/trace/trace.module';
import { OrderModule } from './modules/order/order.module';
import { StockModule } from './modules/stock/stock.module';
import { RebateModule } from './modules/rebate/rebate.module';
import { PrintModule } from './modules/print/print.module';
import { CrmModule } from './modules/crm/crm.module';
import { AuditModule } from './modules/audit/audit.module';
import { AiModule } from './modules/ai/ai.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    EventsModule,
    AuditModule,
    AuthModule,
    OrgModule,
    ProductModule,
    ClinicModule,
    TraceModule,
    OrderModule,
    StockModule,
    RebateModule,
    PrintModule,
    CrmModule,
    AiModule,
  ],
})
export class AppModule {}
