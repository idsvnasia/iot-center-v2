import React, {useContext, useEffect, useRef} from 'react'
import {DataManagerContext} from '../..'
import {ManagedMap} from '../ManagedMap'

type ManagedMapReactParams = {
  keys: [string, string]
}

export const ManagedMapReact: React.FC<ManagedMapReactParams> = ({keys}) => {
  const elementRef = useRef<HTMLDivElement>(null)
  const element = (
    <div
      style={{
        width: '100%',
        height: '100%',
      }}
      ref={elementRef}
    />
  )

  const manager = useContext(DataManagerContext)

  const mapRef = useRef<ManagedMap>()

  useEffect(() => {
    if (!elementRef.current) return

    mapRef.current = new ManagedMap(manager, elementRef.current)
  }, [manager])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.manager = manager
  }, [manager])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.keys = keys
  }, [keys])

  useEffect(() => {
    mapRef.current?.render?.()
  })

  return <>{element}</>
}
