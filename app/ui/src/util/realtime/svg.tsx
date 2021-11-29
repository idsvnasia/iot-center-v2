import React, {useEffect, useRef} from 'react'
import {format, isFormatString} from '../format'
import {useRafOnce} from '.'

/*
  for updating svg from inkskape:
    - in inskape -> save as copy - plain svg format (not inskape-svg format)
    - minify in https://www.svgminify.com/
    - remove <metadata> with it's conent
    - remove all naspaced attributes (containing : e.g. xmlns:dc) of svg element 
*/

export type RealtimeSVGData =
  | Record<string, number | string>
  | [string, number | string][]
  | {value: string | number; key: string; time: number | undefined}[]

const isDiagramEntryPointsArray = (
  arr: any[] | {key: string; value: number | string}[]
): arr is {key: string; value: number | string}[] => {
  return 'value' in arr[0]
}

// TODO: add number formating (decimals etc) to formater, formater will output text like ---.-- when number is missing as a placeholder, remove replace("undefined", "") and formating in RealTimePage
export const useRelatimeSVG = (
  SvgTemplateElement: React.FunctionComponent<React.SVGProps<SVGSVGElement>>
): {
  svgElement: JSX.Element
  svgUpdate: (data: RealtimeSVGData) => void
  svgClear: () => void
} => {
  const formatableElementsRef = useRef<{el: Element; formatString: string}[]>(
    []
  )
  const fieldsRef = useRef<Record<string, number | string>>({})

  const update = useRafOnce(() => {
    for (const {el, formatString} of formatableElementsRef.current) {
      try {
        el.textContent = format(formatString, fieldsRef.current).replace(
          'undefined',
          ''
        )
      } catch (e) {
        console.error(e)
      }
    }
  })

  const svgUpdate = (data: RealtimeSVGData) => {
    let _data = data
    if (Array.isArray(_data)) {
      if (isDiagramEntryPointsArray(_data))
        _data = Object.fromEntries(_data.map(({key, value}) => [key, value]))
      else _data = Object.fromEntries(_data)
    }

    fieldsRef.current = {...fieldsRef.current, ..._data}
    update()
  }

  const svgClear = () => {
    fieldsRef.current = {}
    update()
  }

  const elementRef = useRef<HTMLDivElement>(null)

  const svgElement = (
    <div ref={elementRef}>
      <SvgTemplateElement />
    </div>
  )

  const reset = () => {
    for (const {el, formatString} of formatableElementsRef.current) {
      el.textContent = formatString
    }
    formatableElementsRef.current = []
  }

  useEffect(() => {
    formatableElementsRef.current = []

    const root = elementRef.current
    const rec = (el: Element | null) => {
      if (!el) return
      const child = Array.from(el.children)
      child.forEach(rec)
      if (
        !child.length &&
        el.nodeName !== 'style' &&
        el.nodeName !== 'script'
      ) {
        const text = el.textContent || ''
        if (isFormatString(text)) {
          if (!formatableElementsRef.current.some(({el: x}) => x === el))
            formatableElementsRef.current.push({el, formatString: text})
        }
      }
    }
    rec(root)

    update()

    return reset
  })

  return {svgElement, svgUpdate, svgClear}
}
