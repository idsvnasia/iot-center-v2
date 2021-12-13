import React from 'react'
import Icon from '@ant-design/icons'

import {ReactComponent as DashboardSvg} from './icons/dashboard.svg'
import {ReactComponent as DeleteSvg} from './icons/delete.svg'
import {ReactComponent as SettingsSvg} from './icons/settings.svg'
import {ReactComponent as DeviceRegistrationSvg} from './icons/deviceRegistration.svg'
import {ReactComponent as HomeSvg} from './icons/home.svg'
import {ReactComponent as VirtualDeviceSvg} from './icons/virtualDevice.svg'
import {ReactComponent as RefreshSvg} from './icons/refresh.svg'
import {ReactComponent as WriteDataSvg} from './icons/writeData.svg'

export const IconDashboard: React.FC = () => <Icon component={DashboardSvg} />
export const IconDelete: React.FC = () => <Icon component={DeleteSvg} />
export const IconSettings: React.FC = () => <Icon component={SettingsSvg} />
export const IconDeviceRegistration: React.FC = () => (
  <Icon component={DeviceRegistrationSvg} />
)
export const IconHome: React.FC = () => <Icon component={HomeSvg} />
export const IconVirtualDevice: React.FC = () => (
  <Icon component={VirtualDeviceSvg} />
)
export const IconRefresh: React.FC = () => <Icon component={RefreshSvg} />
export const IconWriteData: React.FC = () => <Icon component={WriteDataSvg} />

export {
  LineChartOutlined as IconDynamicDashboard,
  PlayCircleOutlined as IconRealtimeDashboard,
} from '@ant-design/icons'
