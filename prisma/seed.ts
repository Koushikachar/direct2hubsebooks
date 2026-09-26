import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// This project no longer ships a fake-review seed. Earlier versions of
// this script inserted a batch of fabricated names/ratings/comments into
// the Review table so the site would look pre-populated — that is
// undisclosed fake social proof and a real legal risk (misleading
// advertising / fake-review rules), so it has been removed rather than
// left "off by default". Only real reviews submitted through the review
// form (and verified against a real order) should ever land in this
// table.
async function main() {
  const existing = await prisma.review.count();
  console.log(
    `Nothing to seed — this project intentionally ships no demo/fake reviews. ` +
      `${existing} real review(s) currently in the database.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
