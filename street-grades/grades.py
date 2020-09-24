import json
import argparse
import pandas
from elevation import ElevationData


def main():
    parser = argparse.ArgumentParser(
        "Merges an OSM road network with elevation data to produce grade data."
    )
    parser.add_argument(
        "--edges_csv",
        help="Path to CSV file of edges, from osmnet. Must have from_lat, from_lng, to_lat, to_lng",
    )
    parser.add_argument("--latlng", nargs="*", help="lat", default=[])
    args = parser.parse_args()

    elevation_data = ElevationData("data")

    if args.latlng:
        lat = float(args.latlng[0])
        lng = float(args.latlng[1])

        print("{}, {}".format(lat, lng))
        print("{}".format(elevation_data.get_elevation(lat, lng)))

    elif args.edges_csv:
        print(f"Read CSV from {args.edges_csv}")
        edges = pandas.read_csv(args.edges_csv)

        from_elevation = []
        to_elevation = []
        grades = []
        grades2 = []
        for idx, row in edges.iterrows():
            from_elevation.append(
                elevation_data.get_elevation(row["from_lat"], row["from_lng"])
            )
            to_elevation.append(
                elevation_data.get_elevation(row["to_lat"], row["to_lng"])
            )

            grades.append(
                round(
                    100.0 * (to_elevation[-1] - from_elevation[-1]) / row["distance"], 2
                )
            )
            grades2.append(int(grades[-1] / 5))

            if idx % 100 == 0:
                print(idx)

        edges["from_elevation"] = from_elevation
        edges["to_elevation"] = to_elevation
        edges["grade"] = grades
        edges["grade_category"] = grades2

        just_hills = edges[abs(edges["grade"]) > 2.0]

        edges.to_csv("/tmp/e3.csv")
        just_hills.to_csv("/tmp/just_hills.csv")
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
