// Static homepage images (Cloudinary CDN). The home page uses these directly so the hero paints at once,
// without waiting for the API. Rankings and the vote pages still use live data.
export const HOME_PEOPLE = [
  { name: "Arijit Singh", category: "singers-musicians", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505831/famevote/celebrities/arijit-singh.jpg" },
  { name: "Amitabh Bachchan", category: "actors", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505627/famevote/celebrities/amitabh-bachchan.jpg" },
  { name: "Bhuvan Bam", category: "influencers-content-creators", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505876/famevote/celebrities/bhuvan-bam.jpg" },
  { name: "Ekta Kapoor", category: "tv-personalities", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792506172/famevote/celebrities/ekta-kapoor.jpg" },
  { name: "Shah Rukh Khan", category: "actors", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505611/famevote/celebrities/shah-rukh-khan.jpg" },
  { name: "Deepika Padukone", category: "actors", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505660/famevote/celebrities/deepika-padukone.jpg" },
  { name: "Virat Kohli", category: "athletes-sports-personalities", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505926/famevote/celebrities/virat-kohli.jpg" },
  { name: "Zakir Khan", category: "comedians", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792506231/famevote/celebrities/zakir-khan.jpg" },
  { name: "Alia Bhatt", category: "actors", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505671/famevote/celebrities/alia-bhatt.jpg" },
  { name: "Kapil Sharma", category: "comedians", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792506198/famevote/celebrities/kapil-sharma.jpg" },
  { name: "MS Dhoni", category: "athletes-sports-personalities", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505947/famevote/celebrities/ms-dhoni.jpg" },
  { name: "Shreya Ghoshal", category: "singers-musicians", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505837/famevote/celebrities/shreya-ghoshal.jpg" },
  { name: "Neeraj Chopra", category: "athletes-sports-personalities", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505952/famevote/celebrities/neeraj-chopra.jpg" },
  { name: "Prajakta Koli", category: "influencers-content-creators", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505896/famevote/celebrities/prajakta-koli.jpg" },
  { name: "Aishwarya Rai Bachchan", category: "models", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792506290/famevote/celebrities/aishwarya-rai-bachchan.jpg" },
  { name: "Diljit Dosanjh", category: "singers-musicians", image: "https://res.cloudinary.com/plhpyscn/image/upload/v1792505856/famevote/celebrities/diljit-dosanjh.jpg" },
];

// One representative photo per category slug, for the category tiles.
export const CATEGORY_IMAGE = {
  "singers-musicians": "https://res.cloudinary.com/plhpyscn/image/upload/v1792505831/famevote/celebrities/arijit-singh.jpg",
  "actors": "https://res.cloudinary.com/plhpyscn/image/upload/v1792505627/famevote/celebrities/amitabh-bachchan.jpg",
  "influencers-content-creators": "https://res.cloudinary.com/plhpyscn/image/upload/v1792505876/famevote/celebrities/bhuvan-bam.jpg",
  "tv-personalities": "https://res.cloudinary.com/plhpyscn/image/upload/v1792506172/famevote/celebrities/ekta-kapoor.jpg",
  "athletes-sports-personalities": "https://res.cloudinary.com/plhpyscn/image/upload/v1792505926/famevote/celebrities/virat-kohli.jpg",
  "comedians": "https://res.cloudinary.com/plhpyscn/image/upload/v1792506231/famevote/celebrities/zakir-khan.jpg",
  "models": "https://res.cloudinary.com/plhpyscn/image/upload/v1792506290/famevote/celebrities/aishwarya-rai-bachchan.jpg",
  "other": "https://res.cloudinary.com/plhpyscn/image/upload/famevote/celebrities/sudha-murty.jpg",
};
