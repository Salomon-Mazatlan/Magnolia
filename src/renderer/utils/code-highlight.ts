import type React from 'react'

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3
    ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ]
}

export function blendColors(colors: string[], alpha: number): string {
  if (colors.length === 0) return 'transparent'
  if (colors.length === 1) {
    const [r, g, b] = hexToRgb(colors[0])
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  let rSum = 0, gSum = 0, bSum = 0
  for (const c of colors) {
    const [r, g, b] = hexToRgb(c)
    rSum += r; gSum += g; bSum += b
  }
  const n = colors.length
  return `rgba(${Math.round(rSum / n)}, ${Math.round(gSum / n)}, ${Math.round(bSum / n)}, ${alpha})`
}

export function multiColorUnderline(colors: string[]): React.CSSProperties {
  if (colors.length === 0) return {}
  if (colors.length === 1) {
    return {
      borderBottom: `2px solid ${colors[0]}`,
      paddingBottom: 1
    }
  }
  const segmentWidth = 4
  const stops: string[] = []
  for (let i = 0; i < colors.length; i++) {
    const start = i * segmentWidth
    const end = (i + 1) * segmentWidth
    stops.push(`${colors[i]} ${start}px, ${colors[i]} ${end}px`)
  }
  const totalWidth = colors.length * segmentWidth
  return {
    backgroundImage: `repeating-linear-gradient(90deg, ${stops.join(', ')})`,
    backgroundSize: `${totalWidth}px 2.5px`,
    backgroundPosition: 'bottom left',
    backgroundRepeat: 'repeat-x',
    paddingBottom: 3
  }
}
