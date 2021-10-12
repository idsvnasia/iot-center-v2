import React from 'react'
import PageContent from './PageContent'

const NoConfigurationPage = () => {
  return (
    <PageContent
      title={
        'Influx nor mqtt not configured, please setup at least one and restart server'
      }
      children={[]}
    />
  )
}

export default NoConfigurationPage
