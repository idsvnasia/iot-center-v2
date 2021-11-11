import React, {useEffect, useRef} from 'react'
import {format, isFormatString} from '../format'
import {useRafOnce} from '../realtimeUtils'
import {ReactComponent as SvgFactory} from './IoT_Center_Diagram_v2.svg'

/*
  for updating svg from inkskape:
    - in inskape -> save as copy - plain svg format (not inskape-svg format)
    - minify in https://www.svgminify.com/
    - remove <metadata> with it's conent
    - remove all naspaced attributes (containing : e.g. xmlns:dc) of svg element 
*/

export const useSVGRelatimeFactory = () => {
  const formatableElementsRef = useRef<{el: Element; formatString: string}[]>(
    []
  )
  const fieldsRef = useRef<Record<string, number | string>>({})

  const update = useRafOnce(() => {
    for (const {el, formatString} of formatableElementsRef.current) {
      try {
        el.textContent = format(formatString, fieldsRef.current)
      } catch (e) {
        console.error(e)
      }
    }
  })

  const updateFactory = (data: Record<string, number | string>) => {
    fieldsRef.current = {...fieldsRef.current, ...data}
    update()
  }

  const clearFactory = () => {
    fieldsRef.current = {}
    update()
  }

  const elementRef = useRef<SVGSVGElement>(null)

  const factoryElement = (
    <div>
      <SvgFactory ref={elementRef} />
    </div>
  )

  const reset = () =>{
    for (const {el, formatString} of formatableElementsRef.current) {
      el.textContent = formatString
    }
    formatableElementsRef.current = []
  }

  useEffect(() => {
    const root = elementRef.current

    const rec = (el: Element | null) => {
      if (!el) return;
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

  return {factoryElement, updateFactory, clearFactory}
}
