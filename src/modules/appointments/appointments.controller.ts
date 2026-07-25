import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { UserRole } from 'src/common/enums';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RoleGuard } from 'src/common/guards/role.guard';
import { Roles } from 'src/common/decorators/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';

import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';

@ApiTags('appointments')
@ApiBearerAuth()
@Controller('appointments')
@UseGuards(JwtAuthGuard, RoleGuard)
@Roles(UserRole.PATIENT)
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  // Static routes first — must be defined before /:id routes

  @Get()
  @ApiOperation({ summary: "List the authenticated patient's appointments" })
  @ApiResponse({ status: 200, description: 'List of appointments' })
  listAppointments(@CurrentUser() user: JwtPayload) {
    return this.appointmentsService.listAppointments(user.sub);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Book an appointment' })
  @ApiResponse({ status: 201, description: 'Appointment created' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  createAppointment(@Body() dto: CreateAppointmentDto, @CurrentUser() user: JwtPayload) {
    return this.appointmentsService.createAppointment(user.sub, dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Get appointment stats for the dashboard/shell' })
  @ApiResponse({ status: 200, description: 'Aggregate stats' })
  getStats(@CurrentUser() user: JwtPayload) {
    return this.appointmentsService.getStats(user.sub);
  }

  // Dynamic routes below

  @Patch(':id')
  @ApiOperation({ summary: 'Update appointment details (provider, specialty, facility, type, note)' })
  @ApiResponse({ status: 200, description: 'Updated appointment' })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  updateAppointment(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appointmentsService.updateAppointment(user.sub, id, dto);
  }

  @Patch(':id/reschedule')
  @ApiOperation({ summary: 'Reschedule an appointment' })
  @ApiResponse({ status: 200, description: 'Rescheduled appointment' })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  @ApiResponse({ status: 409, description: 'Appointment is cancelled or completed' })
  @ApiResponse({ status: 422, description: 'Validation failed' })
  rescheduleAppointment(
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.appointmentsService.rescheduleAppointment(user.sub, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an appointment' })
  @ApiResponse({ status: 200, description: 'Cancelled appointment' })
  @ApiResponse({ status: 404, description: 'Appointment not found' })
  @ApiResponse({ status: 409, description: 'Appointment is already cancelled or completed' })
  cancelAppointment(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.appointmentsService.cancelAppointment(user.sub, id);
  }
}
