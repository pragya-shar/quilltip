export function LiteraryObject({ kind }: { kind: number }) {
  switch (kind) {
    case 0:
      return (
        <g>
          <path d="M30 12H118L140 35V155H30Z" />
          <path
            d="M118 12V35H140M46 55H114M46 70H122M46 85H108M46 113H118M46 130H99"
            fill="none"
          />
          <path d="M45 87H107" strokeWidth="9" opacity=".3" />
        </g>
      )
    case 1:
      return (
        <g>
          <path d="M47 12H116V150L81 126L47 150Z" />
          <path d="M62 49H100M62 66H100M62 83H88" fill="none" />
          <path
            d="M70 30V12Q70 1 81 1Q92 1 92 12V38Q92 46 85 46Q78 46 78 38V17"
            fill="none"
          />
        </g>
      )
    case 2:
      return (
        <g>
          <path d="M10 35H158V132H10Z" />
          <path
            d="M10 35L84 91L158 35M10 132L61 78M158 132L107 78"
            fill="none"
          />
          <circle cx="84" cy="89" r="15" fill="currentColor" />
          <path d="M77 89l5 5 10-12" fill="none" stroke="#e4d2bd" />
        </g>
      )
    case 3:
      return (
        <g>
          <path d="M53 76H105L115 97V140Q79 152 43 140V97Z" />
          <path d="M55 64H103V80H55Z" fill="currentColor" />
          <path d="M58 108Q80 100 101 108V132Q80 139 58 132Z" />
          <path
            d="M79 64L107 19L115 16L116 26L88 67M107 19L115 26M28 160Q58 154 127 157M66 120Q76 111 85 119T98 121"
            fill="none"
          />
        </g>
      )
    case 4:
      return (
        <g>
          <path d="M18 23L127 9L149 150L40 166Z" />
          <path d="M34 19H137V153H34Z" />
          <path
            d="M48 44H117M48 61H123M48 78H112M48 95H120M48 126Q64 113 78 125T117 121M48 94L117 87M57 108L112 106"
            fill="none"
          />
        </g>
      )
    case 5:
      return (
        <g>
          <path d="M20 128L124 19L138 33L34 142L10 154Z" />
          <path
            d="M124 19L131 12Q135 8 139 13L145 19Q149 23 145 27L138 33M20 128L34 142M27 135L131 26M10 154L19 148M61 142Q87 121 113 136T157 126"
            fill="none"
          />
        </g>
      )
    case 6:
      return (
        <g>
          <path d="M20 48Q51 33 83 49Q115 33 150 48V136Q117 121 83 138Q49 121 20 136Z" />
          <path
            d="M83 49V138M33 66Q55 57 70 66M33 82Q55 73 70 82M97 66Q120 57 136 66M97 82Q120 73 136 82M33 99Q55 90 70 99M97 99Q120 90 136 99"
            fill="none"
          />
        </g>
      )
    case 7:
      return (
        <g>
          <path d="M35 59H119V101Q117 133 77 133Q37 133 35 101Z" />
          <path
            d="M119 69H134Q153 88 133 106H118M22 140Q80 156 140 140M57 45Q43 30 58 18M80 45Q66 30 81 18M102 45Q88 30 103 18"
            fill="none"
          />
        </g>
      )
    case 8:
      return (
        <g fill="none">
          <circle cx="47" cy="90" r="29" />
          <circle cx="122" cy="90" r="29" />
          <path d="M76 85Q84 75 93 85M18 90L27 39Q30 31 42 35M151 90L142 39Q139 31 127 35" />
        </g>
      )
    case 9:
      return (
        <g>
          <path d="M27 24H143V147H27Z" />
          <path
            d="M27 58H143M27 89H143M27 120H143M43 40H77M43 72H122M43 103H108M43 134H91"
            fill="none"
          />
          <path d="M99 15H132V49H99Z" />
        </g>
      )
    case 10:
      return (
        <g>
          <path d="M61 93L104 93L115 146H50Z" />
          <ellipse cx="82" cy="146" rx="35" ry="9" />
          <path d="M64 92V54Q43 45 54 25Q79 5 104 25Q117 45 98 54V92Z" />
          <path d="M32 160H133M69 111H97" fill="none" />
        </g>
      )
    default:
      return (
        <g>
          <path d="M32 144Q54 59 142 19Q149 79 93 107L69 103L74 122L51 124Z" />
          <path
            d="M24 157L130 32M55 119L51 92M77 94L74 70M99 70L98 49M66 108L96 105M88 83L119 78"
            fill="none"
          />
        </g>
      )
  }
}
