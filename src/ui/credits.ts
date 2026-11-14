// Written with AI assistance (Claude Code). See README "Use of AI tools".
import { h } from './dom';

const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

export function renderCredits(): HTMLElement[] {
  return [
    h('div', { class: 'kicker' }, 'Credits'),
    h('h2', null, 'Escape Velocity'),
    h('p', null, 'Made by Team Escape Velocity (Spencer Hedges and Sandeep Talari) in Charlotte, NC, for the 2026 NASA Space Apps Challenge: "Build a Junior Astronaut Mission Trainer".'),
    h('p', { class: 'title-foot' }, 'This is a student hackathon project. It is not made, endorsed or reviewed by NASA or any space agency.'),

    h('h3', null, 'Use of AI tools'),
    h(
      'ul',
      { class: 'clean' },
      h('li', null, h('b', null, 'Code: '), 'written with AI assistance (Claude Code by Anthropic) and reviewed by our team. Each source file says so at the top.'),
      h('li', null, h('b', null, 'Images: '), 'all illustrations, including the crew portraits, are AI-generated with Higgsfield (GPT Image 2.6) and carry a visible "AI-generated" watermark (an "AI" tag on each small crew portrait). The crew members are made up. The one exception is the picture of the Sun: it is a real NASA photo (see below).'),
      h('li', null, h('b', null, 'Music: '), 'AI-generated with Higgsfield (ElevenLabs Music v2.5). Sound effects are made in code.'),
      h('li', null, h('b', null, 'Data: '), 'all space-weather, radiation and biology data comes straight from NASA sources (listed below and in the Science Log). Our AI-assisted scripts fetch and reformat it; they never invent values.'),
      h('li', null, 'Every generated asset, with its prompt, is listed in ASSETS.md in our code repository.'),
    ),

    h('h3', null, 'Data sources'),
    h(
      'ul',
      { class: 'clean' },
      h('li', null, link('https://ccmc.gsfc.nasa.gov/tools/DONKI/', 'NASA DONKI'), ' (Community Coordinated Modeling Center): solar flares, particle storms, CMEs, geomagnetic storms.'),
      h('li', null, link('https://sdo.gsfc.nasa.gov/', 'NASA Solar Dynamics Observatory'), ': the live picture of the Sun (Image: NASA/SDO, AIA 171).'),
      h('li', null, link('https://ssd.jpl.nasa.gov/planets/approx_pos.html', 'JPL Solar System Dynamics'), ': planetary orbital elements; ', link('https://ssd.jpl.nasa.gov/horizons/', 'JPL Horizons'), ' for checking.'),
      h('li', null, link('https://visualization.osdr.nasa.gov/radlab/gui/data-api/', 'NASA OSDR RadLab'), ': ISS radiation dosimetry (DOSTEL, DLR instrument).'),
      h('li', null, link('https://osdr.nasa.gov/bio/repo/', 'NASA Open Science Data Repository'), ': space biology studies.'),
      h('li', null, 'NASA/JPL: Curiosity RAD, MOXIE and Opportunity results; NASA BVAD life-support figures.'),
      h('li', null, link('https://www.asc-csa.gc.ca/eng/youth-educators/resources-stem-and-youth-organizations.asp', 'Canadian Space Agency'), ': food production on the Moon and in remote areas.'),
    ),

    h('h3', null, 'Fonts and libraries'),
    h(
      'ul',
      { class: 'clean' },
      h('li', null, 'Silkscreen by Jason Kottke (SIL Open Font License 1.1).'),
      h('li', null, 'Atkinson Hyperlegible by the Braille Institute (SIL Open Font License 1.1).'),
      h('li', null, 'Three.js (MIT License), Vite (MIT License), Vitest (MIT License).'),
    ),
    h('p', { class: 'title-foot' }, 'No agency logos, flags, mission patches or insignia are used anywhere in this game.'),
  ];
}
