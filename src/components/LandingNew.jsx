import React from 'react';

// The homepage's "New in Exploration Maps" figures and blurbs. A chunk of its own, loaded as the landing page
// renders (the section sits below the fold), so the homepage's first JS does not grow with the copy.
//
// Each figure was rendered in the app from its built-in sample projects (illustrative data; the claims round the
// 3D sample are fictional). Files in public/gallery: <img>.webp (1x), <img>@2x.webp and a .jpg fallback.
const NEW_FEATURES = [
  {
    title: '3D drilling figures',
    desc: 'Block sections with geology on the faces, grade bars along the holes, intercept callouts and a claim-map inset. Export the full figure, or the block alone on a transparent background.',
    img: '3d-block-section', w: 640, h: 427, w2: 1280,
    alt: 'Example Ridge sample as a 3D block section: a cut-away block with geology units on its faces, four drill holes with copper grade bars and intercept brackets, and the legend on the side face',
    href: '/3d', cta: 'Open the 3D maker',
  },
  {
    title: 'Studio style 2D maps',
    desc: 'Rounded cards over the map: a title card that can carry the scale bar and north arrow, a dark project locator, a legend card and true UTM ticks on the frame.',
    img: 'studio-fig2', w: 640, h: 427, w2: 1280,
    alt: 'Cedar Ridge sample map in the Studio style: claims, target areas and drill collars on satellite imagery, a title card with scale bar and north arrow, a dark locator card and UTM ticks on the frame',
  },
  {
    title: 'Share live 3D figures',
    desc: 'Send a link anyone can turn, zoom and download as a PNG, or embed the figure on a project page. Turn on the drill crew and they say hi to visitors.',
    img: '3d-crew-hello', w: 520, h: 347, w2: 780,
    alt: 'Close-up of a 3D figure with the drill crew on: a cartoon rig on its pad and a crew member saying “Howdy!” in a speech bubble',
  },
];

export default function LandingNew() {
  return (
    <>
      <div className="lm-showcase">
        {NEW_FEATURES.map((f) => (
          <figure className="lm-new-card" key={f.img}>
            <div className="lm-show-img">
              <picture>
                <source type="image/webp" srcSet={`/gallery/${f.img}.webp ${f.w}w, /gallery/${f.img}@2x.webp ${f.w2}w`} sizes="(max-width: 720px) 100vw, (max-width: 1000px) 50vw, 400px" />
                <img src={`/gallery/${f.img}.jpg`} alt={f.alt} width={f.w} height={f.h} loading="lazy" decoding="async" />
              </picture>
            </div>
            <figcaption className="lm-show-body">
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
              {f.href && <a className="lm-show-cta" href={f.href} data-track={`New: ${f.title}`}>{f.cta} →</a>}
            </figcaption>
          </figure>
        ))}
      </div>
      <div className="lm-def lm-new-ws">
        <h3>Company workspace</h3>
        <p>
          Each property keeps its maps, 3D figures, data files and drill data in one place your team shares.
          Publish a 3D figure as a frozen, dated version for each release. <a href="/teams/" data-track="New: Workspace">Exploration Maps for Teams →</a>
        </p>
      </div>
    </>
  );
}
