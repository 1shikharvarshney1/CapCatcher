# CapCatcher Benchmark: Ground Truth Label Review

This document lists all 12 synthetic reels and 24 checkable factual claims established **prior** to running any pipeline evaluations.
Every verdict has been checked against authoritative, verified sources (.gov, WHO, NASA, NOAA, peer-reviewed/encyclopedic references).

---

## Dataset Summary
- **Total Reels**: 12
  - **Speech Only**: 3 (Reels 1, 2, 3)
  - **On-Screen Text Only**: 3 (Reels 4, 5, 6)
  - **Both (Speech & Text)**: 4 (Reels 7, 8, 9, 10)
  - **No Checkable Claims**: 2 (Reels 11, 12)
- **Total Checkable Claims**: 24
  - **True**: 8 claims (33.3%)
  - **False**: 15 claims (62.5%)
  - **Misleading**: 1 claim (4.2%)
- **Harder / Stress-Test Cases (5 total)**:
  - Reel 02 (Claims C3, C4): Fast-talking voice (TTS speech rate +4)
  - Reel 03 (Claims C5, C6): Background acoustic noise mixed over speech
  - Reel 05 (Claim C9): Ambiguous energy claim ("electricity to recharge a smartphone")
  - Reel 06 (Claim C11): Historical propaganda/myth with partial truth (carrots & night vision)
  - Reel 07 (Claim C15): Context-dependent idiom/myth ("lightning never strikes twice")

---

## Complete Claim-Level Ground Truth

| Claim ID | Reel | Modality | Timestamps | Claim Text | Ground Truth Verdict | Authoritative Source URL | Source Evidence Summary |
|---|---|---|---|---|---|---|---|
| **C1** | Reel 01 | Speech | 04.0s - 12.0s | The human adult body is typically composed of approximately 60 percent water. | **true** | [Wikipedia: Body Water](https://en.wikipedia.org/wiki/Body_water) | Total body water in average human adults is approximately 60% in adult males and 50–55% in females. |
| **C2** | Reel 01 | Speech | 13.0s - 22.0s | Mount Everest is located entirely within the borders of India. | **false** | [Wikipedia: Mount Everest](https://en.wikipedia.org/wiki/Mount_Everest) | Mount Everest is located in the Mahalangur Himal sub-range on the border between Nepal and Tibet (China), not India. |
| **C3** | Reel 02 | Speech (Fast) | 03.5s - 11.5s | Drinking coffee significantly increases cardiovascular disease mortality in healthy adults. | **false** | [Wikipedia: Health effects of coffee](https://en.wikipedia.org/wiki/Health_effects_of_coffee) | Moderate coffee consumption is consistently associated with lower or neutral all-cause and cardiovascular disease mortality. |
| **C4** | Reel 02 | Speech (Fast) | 12.0s - 20.0s | Drinking warm lemon water cures type 2 diabetes within forty eight hours. | **false** | [WHO Fact Sheet: Diabetes](https://www.who.int/news-room/fact-sheets/detail/diabetes) | Diabetes is a chronic metabolic disease with no 48-hour cure from lemon water. |
| **C5** | Reel 03 | Speech (Noise) | 05.0s - 14.5s | The Great Wall of China is easily visible from the Moon with the naked human eye. | **false** | [NASA Vision: Great Wall](https://www.nasa.gov/vision/space/workinginspace/great_wall.html) | It is an optical myth; the Great Wall is not visible from the Moon to the naked human eye. |
| **C6** | Reel 03 | Speech (Noise) | 15.5s - 24.5s | The speed of light in a vacuum is approximately 300000 kilometers per second. | **true** | [Wikipedia: Speed of Light](https://en.wikipedia.org/wiki/Speed_of_light) | Defined exactly as 299,792,458 m/s, which is approximately 300,000 km/s. |
| **C7** | Reel 04 | Screen | 02.0s - 15.0s | Venus is the hottest planet in our solar system. | **true** | [NASA Science: Venus Facts](https://science.nasa.gov/venus/facts/) | Venus has an intense greenhouse effect making its surface ~900°F (475°C), the hottest in the solar system. |
| **C8** | Reel 04 | Screen | 16.0s - 30.0s | Antibiotics are effective at killing influenza viruses. | **false** | [WHO: Antimicrobial Resistance](https://www.who.int/news-room/fact-sheets/detail/antimicrobial-resistance) | Antibiotics treat bacterial infections, not viral infections like influenza. |
| **C9** | Reel 05 | Screen (Vague) | 02.0s - 15.0s | Bananas generate enough electricity to recharge a modern smartphone. | **false** | [Wikipedia: Lemon / Fruit Battery](https://en.wikipedia.org/wiki/Lemon_battery) | Fruit electrochemical cells produce millivolts/microamps; thousands of bananas would be required to power a phone. |
| **C10** | Reel 05 | Screen | 16.0s - 30.0s | The Sahara Desert is the largest hot desert on Earth. | **true** | [Wikipedia: Sahara](https://en.wikipedia.org/wiki/Sahara) | The Sahara is the largest hot desert in the world (third largest desert overall behind Antarctica and the Arctic). |
| **C11** | Reel 06 | Screen (Myth) | 02.0s - 15.0s | Eating carrots improves human night vision beyond normal 20/20 vision. | **misleading** | [Scientific American](https://www.scientificamerican.com/article/fact-or-fiction-carrots-improve-your-vision/) | Vitamin A prevents deficiency-related night blindness, but eating carrots does not give superhuman or improved night vision beyond baseline normal. Originated in British WWII radar deception. |
| **C12** | Reel 06 | Screen | 16.0s - 30.0s | The Eiffel Tower is located in Berlin, Germany. | **false** | [Wikipedia: Eiffel Tower](https://en.wikipedia.org/wiki/Eiffel_Tower) | The Eiffel Tower is a wrought-iron lattice tower located on the Champ de Mars in Paris, France. |
| **C13** | Reel 07 | Both | 03.0s - 13.0s | The Pacific Ocean is the largest ocean on Earth. | **true** | [NOAA Ocean Facts: Biggest Ocean](https://oceanservice.noaa.gov/facts/biggestocean.html) | The Pacific Ocean covers more than 30% of the Earth's surface and is the largest ocean basin. |
| **C14** | Reel 07 | Both | 14.0s - 24.0s | Sharks are mammals that produce milk for their young. | **false** | [NOAA Ocean Facts: Sharks](https://oceanservice.noaa.gov/facts/shark-mating.html) | Sharks are cartilaginous fish (elasmobranchs), not mammals, and do not have mammary glands or produce milk. |
| **C15** | Reel 07 | Both (Context) | 25.0s - 35.0s | Lightning never strikes the same place twice. | **false** | [NWS / NOAA: Lightning Myths](https://www.weather.gov/safety/lightning-myths) | Lightning frequently strikes the same place repeatedly (e.g. the Empire State Building is struck 25 times per year). |
| **C16** | Reel 08 | Both | 03.0s - 13.0s | Jupiter's Great Red Spot is a giant spinning storm. | **true** | [NASA Science: Jupiter Facts](https://science.nasa.gov/jupiter/facts/) | The Great Red Spot is an enormous anticyclonic storm larger than Earth that has raged for centuries. |
| **C17** | Reel 08 | Both | 14.0s - 24.0s | Humans only use 10 percent of their brain. | **false** | [Wikipedia: 10% Brain Myth](https://en.wikipedia.org/wiki/Ten_percent_of_the_brain_myth) | Neurological imaging confirms virtually all parts of the human brain have identified functions and remain active. |
| **C18** | Reel 08 | Both | 25.0s - 35.0s | Sound waves travel faster through air than through solid steel. | **false** | [Wikipedia: Speed of Sound](https://en.wikipedia.org/wiki/Speed_of_sound) | Speed of sound in air is ~343 m/s; in steel it travels roughly 15 times faster (~5,000 m/s). |
| **C19** | Reel 09 | Both | 03.0s - 13.0s | The human heart pumps thousands of gallons of blood each day. | **true** | [Wikipedia: Heart](https://en.wikipedia.org/wiki/Heart) | The human heart beats ~100,000 times/day, pumping roughly 2,000 gallons (7,570 liters) of blood daily. |
| **C20** | Reel 09 | Both | 14.0s - 24.0s | Cracking your knuckles causes arthritis in your fingers. | **false** | [Wikipedia: Joint Cracking](https://en.wikipedia.org/wiki/Joint_cracking) | Numerous scientific studies (including Dr. Donald Unger's landmark study) show no causal link between knuckle cracking and osteoarthritis. |
| **C21** | Reel 09 | Both | 25.0s - 35.0s | Drinking pure water completely cures all forms of cancer. | **false** | [WHO Fact Sheet: Cancer](https://www.who.int/news-room/fact-sheets/detail/cancer) | Cancer is caused by genetic mutations leading to abnormal cellular growth; drinking water is necessary for hydration but is not a cure for oncological malignancies. |
| **C22** | Reel 10 | Both | 03.0s - 13.0s | The Amazon rainforest is located primarily in South America. | **true** | [Wikipedia: Amazon Rainforest](https://en.wikipedia.org/wiki/Amazon_rainforest) | The Amazon covers 5.5 million square km across 9 South American countries. |
| **C23** | Reel 10 | Both | 14.0s - 24.0s | Vaccines contain tracking microchips connected to 5G cellular networks. | **false** | [Wikipedia: Vaccine Misinformation](https://en.wikipedia.org/wiki/COVID-19_vaccine_misinformation_and_hesitancy) | Thoroughly debunked conspiracy theory with zero physical or biological basis. |
| **C24** | Reel 10 | Both | 25.0s - 35.0s | Consuming refined sugar is the sole cause of type 1 diabetes. | **false** | [WHO Fact Sheet: Diabetes](https://www.who.int/news-room/fact-sheets/detail/diabetes) | Type 1 diabetes is an autoimmune reaction destroying pancreatic beta cells; it is not caused by dietary sugar intake. |

---

## Negative Control Reels (No Checkable Claims)

| Reel | Modality | Duration | Content Description | Ground Truth Claims Count |
|---|---|---|---|---|
| **Reel 11** | Speech only | 30s | Vlogger morning routine discussing grinding coffee beans, enjoying stillness of the morning, and wishing viewers a good day. | **0 claims** (`claims: []`) |
| **Reel 12** | Both (Speech & Text) | 30s | Casual creator greeting asking viewers whether they prefer sci-fi thrillers or cozy comedies, soliciting comments. | **0 claims** (`claims: []`) |

